// src/controllers/trip.controller.ts (Novo Arquivo)
import AppError from '../utils/AppError';
import { Prisma, PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { CreateTripInput, CreateTripParams, createTripSchema, GetOrDeleteTripParams, getOrDeleteTripSchema, ListTripsParams, ListTripsQuery, listTripsSchema, UpdateTripInput, UpdateTripParams, updateTripSchema } from '../validators/trip.validator';
import { getEndOfDay, getStartOfDay } from './report.controller';
import { AppEnv, Context, Hono } from 'hono';
import { PrismaD1 } from '@prisma/adapter-d1';
import { protect } from 'middlewares/auth.middleware';
import next from 'middlewares/next.middleware';
import vehicleRoutesController, { checkVehicleAccess } from './vehicle.controller';
import permissions from 'utils/permissions';
import { zValidator } from '@hono/zod-validator';
import { authorize } from 'middlewares/authorize.middleware';

// Helper (opcional, pode estar em vehicle.service ou utils)
async function getVehicleForUpdate(tx: Prisma.TransactionClient, vehicleId: string, userId: string) {
    const vehicle = await tx.vehicle.findUnique({
        where: { id: vehicleId },
        select: { id: true, ownerId: true, appFuelTank: true, authorizedUsers: { where: { userId } } }
    });
    if (!vehicle) throw new AppError('Veículo não encontrado.', 404);
    if (vehicle.ownerId !== userId && vehicle.authorizedUsers.length === 0) {
        throw new AppError('Acesso negado a este veículo.', 403);
    }
    return vehicle;
}

const getPrisma = (c: Context<AppEnv>) => {
    const adapter = new PrismaD1(c.env.DB);
    const prisma = new PrismaClient({ adapter });
    if (!prisma) throw new AppError('Internal server configuration error (Prisma).', 500);
    return prisma;
}

// ==============================
// trip Routes
// ==============================

vehicleRoutesController.post(
    '/:vehicleId/trips',
    authorize([permissions.user.any]), // <<< Nova permissão necessária
    zValidator('param', createTripSchema.shape.params),
    zValidator('json', createTripSchema.shape.body),
    async (c) => {
        const userId = c.get('user').id;
        const { vehicleId } = c.req.valid('param');
        const {
            startTime,
            endTime,
            distance,
            consumptionRateUsed, // Taxa (km/L) que o app usou/calculou
            routePath,
            notes
        } = c.req.valid('json');

        try {
            const prisma = getPrisma(c);
            const distanceDecimal = new Decimal(distance);
            const consumptionRateDecimal = new Decimal(consumptionRateUsed);

            // Validações básicas
            if (distanceDecimal.isNegative()) return next(new AppError('Distância não pode ser negativa.', 400));
            if (consumptionRateDecimal.isNegative() || consumptionRateDecimal.isZero()) {
                return next(new AppError('Taxa de consumo deve ser positiva.', 400));
            }

            // Calcula o combustível consumido
            const fuelConsumedDecimal = distanceDecimal.dividedBy(consumptionRateDecimal).toDecimalPlaces(5, Decimal.ROUND_HALF_UP); // 5 casas decimais para combustível

            if (!fuelConsumedDecimal.isFinite() || fuelConsumedDecimal.isNegative()) {
                return next(new AppError('Falha ao calcular combustível consumido.', 500));
            }

            // --- Transação para criar Trip e atualizar Veículo ---
            const result = await prisma.$transaction(async (tx) => {

                // 1. Verifica acesso ao veículo dentro da transação (para lock implícito)
                const vehicle = await getVehicleForUpdate(tx, vehicleId, userId);

                // 2. Cria o registro da Viagem (Trip)
                const newTrip = await tx.trip.create({
                    data: {
                        startTime: new Date(startTime),
                        endTime: new Date(endTime),
                        distance: distanceDecimal,
                        fuelConsumed: fuelConsumedDecimal, // <<< Combustível calculado
                        consumptionRateUsed: consumptionRateDecimal, // <<< Taxa usada
                        routePath: routePath ?? Prisma.JsonNull, // Usa JsonNull se routePath for undefined
                        notes: notes,
                        vehicleId: vehicleId,
                        userId: userId,
                        momentAppFuelTank: vehicle.appFuelTank,
                    },
                    select: {
                        id: true,
                        startTime: true,
                        endTime: true,
                        distance: true,
                        fuelConsumed: true,
                        notes: true,
                        vehicle: { select: { id: true, alias: true } },
                        routePath: true,
                        momentAppFuelTank: true,
                        consumptionRateUsed: true,
                        createdAt: true,
                        updatedAt: true,
                    }
                });

                // 3. Atualiza o Veículo: Incrementa hodômetro, Decrementa tanque
                await tx.vehicle.update({
                    where: { id: vehicleId },
                    data: {
                        appOdometer: {
                            increment: distanceDecimal // Adiciona distância percorrida
                        },
                        appFuelTank: {
                            decrement: fuelConsumedDecimal // Remove combustível consumido
                            // TODO: Considerar o que fazer se appFuelTank ficar negativo?
                            // Poderia lançar erro, logar, ou apenas permitir (indicando erro de cálculo/taxa)
                        }
                    }
                });

                return newTrip; // Retorna a viagem criada
            });

            return c.json(result);

        } catch (error) {
            // Verifica se o erro é de tanque negativo (se implementado com constraint CHECK no DB)
            // Ou trata AppError vindo do getVehicleForUpdate
            next(error);
        }
    }
);

// GET /api/vehicles/:vehicleId/trips - Listar viagens
vehicleRoutesController.get(
    '/:vehicleId/trips',
    authorize([permissions.user.any]),
    zValidator('param', listTripsSchema.shape.params),
    zValidator('query', listTripsSchema.shape.query),
    async (c) => {
        const userId = c.get('user').id;
        const { vehicleId } = c.req.valid('param');
        const { startDate, endDate, page = 1, limit = 15 } = c.req.valid('query') ?? {};

        try {
            const prisma = getPrisma(c);
            // 1. Check vehicle access
            const hasAccess = await checkVehicleAccess(prisma, userId, vehicleId);
            if (!hasAccess) return next(new AppError('Acesso negado ou veículo não encontrado.', 403));

            // 2. Build where clause
            const skip = (page - 1) * limit;
            const where: Prisma.TripWhereInput = {
                vehicleId: vehicleId,
                userId: userId, // Geralmente queremos listar apenas as viagens do próprio usuário
            };
            if (startDate) where.startTime = { gte: getStartOfDay(startDate) };
            if (endDate) where.endTime = { lte: getEndOfDay(endDate) }; // Usa helper de data

            // 3. Fetch trips and count
            const [trips, totalCount] = await prisma.$transaction([
                prisma.trip.findMany({
                    where: where,
                    orderBy: { startTime: 'desc' }, // Mais recentes primeiro
                    skip: skip,
                    take: limit,
                    select: { // Selecionar campos para a lista
                        id: true,
                        startTime: true,
                        endTime: true,
                        distance: true,
                        fuelConsumed: true,
                        notes: true,
                        vehicle: { select: { id: true, alias: true } },
                        routePath: true,
                        momentAppFuelTank: true,
                        consumptionRateUsed: true,
                        createdAt: true,
                        updatedAt: true,
                    }
                }),
                prisma.trip.count({ where: where })
            ]);

            return c.json({
                data: trips,
                meta: { currentPage: page, pageSize: limit, totalItems: totalCount, totalPages: Math.ceil(totalCount / limit) }
            });

        } catch (error) {
            next(error);
        }
    }
);


// GET /api/vehicles/:vehicleId/trips/:tripId - Obter viagem específica
vehicleRoutesController.get(
    '/:vehicleId/trips/:tripId',
    authorize([permissions.user.any]), // Controller verifica acesso específico
    zValidator('param', getOrDeleteTripSchema.shape.params), // Valida ambos IDs
    async (c) => {
        const userId = c.get('user').id;
        const { vehicleId, tripId } = c.req.valid('param'); // Extrai ambos os IDs

        try {
            const prisma = getPrisma(c);
            // 1. Busca a viagem
            const trip = await prisma.trip.findUnique({
                where: { id: tripId },
                select: {
                    id: true,
                    startTime: true,
                    endTime: true,
                    distance: true,
                    fuelConsumed: true,
                    notes: true,
                    vehicle: { select: { id: true, alias: true } },
                    routePath: true,
                    momentAppFuelTank: true,
                    consumptionRateUsed: true,
                    createdAt: true,
                    updatedAt: true,
                    user: { select: { id: true, name: true } },
                }
            });

            if (!trip) {
                return next(new AppError(`Viagem com ID ${tripId} não encontrada.`, 404));
            }

            // 2. Verifica se a viagem pertence ao veículo da URL (sanidade) e se o usuário tem acesso a ELA
            if (trip.vehicle.id !== vehicleId) {
                return next(new AppError(`Viagem ${tripId} não pertence ao veículo ${vehicleId}.`, 400));
            }
            if (trip.user.id !== userId) { // Verifica se o usuário logado é quem registrou a viagem
                // Ou verifica acesso ao veículo? Depende da regra. Assumindo que só quem registrou pode ver/editar.
                // Se qualquer um com acesso ao veículo puder ver:
                // if (!trip.vehicle || (trip.vehicle.ownerId !== userId && trip.vehicle.authorizedUsers.length === 0)) {
                //    return next(new AppError('Acesso negado.', 403));
                // }
                return next(new AppError('Você não tem permissão para acessar esta viagem.', 403));
            }

            return c.json(trip);

        } catch (error) {
            next(error);
        }
    }
);



// PATCH /api/vehicles/:vehicleId/trips/:tripId - Atualizar viagem
vehicleRoutesController.patch(
    '/:vehicleId/trips/:tripId',
    authorize([permissions.user.any]), // Controller verifica acesso específico
    zValidator('param', updateTripSchema.shape.params), // Valida IDs e body
    zValidator('json', updateTripSchema.shape.body), // Valida IDs e body
    async (c) => {
        const userId = c.get('user').id;
        const { vehicleId, tripId } = c.req.valid('param');
        const updateData = c.req.valid('json');

        try {
            const prisma = getPrisma(c);
            const result = await prisma.$transaction(async (tx) => {
                // 1. Busca a viagem ATUAL e verifica acesso/propriedade
                const currentTrip = await tx.trip.findUnique({
                    where: { id: tripId },
                    select: { id: true, vehicleId: true, userId: true, distance: true, fuelConsumed: true, startTime: true, endTime: true, consumptionRateUsed: true }
                });

                if (!currentTrip) throw new AppError('Viagem não encontrada.', 404);
                if (currentTrip.vehicleId !== vehicleId) throw new AppError('Viagem não pertence a este veículo.', 400);
                if (currentTrip.userId !== userId) throw new AppError('Você não pode editar esta viagem.', 403); // Só quem criou pode editar?

                // 2. Prepara dados para atualização da viagem
                const newTripData: Prisma.TripUpdateInput = {};
                if (updateData.startTime) newTripData.startTime = new Date(updateData.startTime);
                if (updateData.endTime) newTripData.endTime = new Date(updateData.endTime);
                if (updateData.distance) newTripData.distance = new Decimal(updateData.distance);
                if (updateData.consumptionRateUsed) newTripData.consumptionRateUsed = new Decimal(updateData.consumptionRateUsed);
                if (updateData.routePath !== undefined) newTripData.routePath = updateData.routePath ?? Prisma.JsonNull;
                if (updateData.notes !== undefined) newTripData.notes = updateData.notes;

                // 3. Recalcula combustível consumido SE distância ou taxa mudaram
                const newDistance = newTripData.distance instanceof Decimal ? newTripData.distance : currentTrip.distance;
                const newRate = newTripData.consumptionRateUsed instanceof Decimal ? newTripData.consumptionRateUsed : currentTrip.consumptionRateUsed;
                let newFuelConsumed: Decimal | undefined = undefined;

                if (newDistance.isPositive() && newRate?.isPositive()) { // Só calcula se tiver dados válidos
                    newFuelConsumed = newDistance.dividedBy(newRate).toDecimalPlaces(5, Decimal.ROUND_HALF_UP);
                    newTripData.fuelConsumed = newFuelConsumed; // Atualiza na viagem
                } else if (updateData.distance !== undefined || updateData.consumptionRateUsed !== undefined) {
                    // Se distância ou taxa foram atualizadas mas resultado não é positivo, algo está errado
                    throw new AppError('Não foi possível recalcular o consumo com os novos valores de distância/taxa.', 400);
                }

                // 4. Atualiza a Viagem
                const updatedTrip = await tx.trip.update({
                    where: { id: tripId },
                    data: newTripData,
                });

                // 5. Calcula as *diferenças* para atualizar o veículo
                const deltaDistance = newDistance.minus(currentTrip.distance);
                const deltaFuel = (newFuelConsumed ?? currentTrip.fuelConsumed).minus(currentTrip.fuelConsumed); // Compara novo calculado com antigo

                // 6. Atualiza o Veículo (se houve mudança na distância ou consumo)
                if (!deltaDistance.isZero() || !deltaFuel.isZero()) {
                    await tx.vehicle.update({
                        where: { id: vehicleId },
                        data: {
                            appOdometer: { increment: deltaDistance },
                            appFuelTank: { decrement: deltaFuel } // Decrementa pelo delta do consumo
                        }
                    });
                }

                return updatedTrip;
            }); // Fim da transação

            return c.json(result);

        } catch (error) {
            next(error); // Captura AppError ou erros do Prisma
        }
    }
);


// DELETE /api/vehicles/:vehicleId/trips/:tripId - Deletar viagem
vehicleRoutesController.delete(
    '/:vehicleId/trips/:tripId',
    authorize([permissions.user.any]), // Controller verifica acesso específico
    zValidator('param', getOrDeleteTripSchema.shape.params),
    async (c) => {
        const userId = c.get('user').id;
        const { vehicleId, tripId } = c.req.valid('param');

        try {
            const prisma = getPrisma(c);
            await prisma.$transaction(async (tx) => {
                // 1. Busca a viagem a ser deletada e verifica acesso/propriedade
                const tripToDelete = await tx.trip.findUnique({
                    where: { id: tripId },
                    select: { id: true, vehicleId: true, userId: true, distance: true, fuelConsumed: true }
                });

                if (!tripToDelete) throw new AppError('Viagem não encontrada.', 404);
                if (tripToDelete.vehicleId !== vehicleId) throw new AppError('Viagem não pertence a este veículo.', 400);
                if (tripToDelete.userId !== userId) throw new AppError('Você não pode deletar esta viagem.', 403);

                // 2. Reverte os efeitos no veículo
                await tx.vehicle.update({
                    where: { id: vehicleId },
                    data: {
                        appOdometer: { decrement: tripToDelete.distance }, // Subtrai a distância
                        appFuelTank: { increment: tripToDelete.fuelConsumed } // Adiciona de volta o combustível
                    }
                });

                // 3. Deleta a viagem
                await tx.trip.delete({
                    where: { id: tripId }
                });
            }); // Fim da transação

            return c.body(null);

        } catch (error) {
            next(error); // Captura AppError ou erros do Prisma
        }
    }
);