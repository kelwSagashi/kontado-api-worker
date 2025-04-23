// src/controllers/station.controller.ts
import AppError from '../utils/AppError';
import { GasStationStatus, Prisma, PrismaClient, ProposalReasonType, ReviewStatus, StationPriceStatus } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library'; // For price conversion

import {
    CreateGasStationInput,
    ReportStationPriceInput, ReportStationPriceParams,
    GetStationsQuery,
    StationIdParams,
    ProposeEditStationParams,
    ProposeEditStationInput,
    createGasStationSchema,
    proposeEditStationSchema,
    idParamSchema,
    reportStationPriceSchema,
    getStationsSchema
} from '../validators/station.validator';
import { authorize, getPermissionsForRole } from '../middlewares/authorize.middleware';

import PERMISSION from '../utils/permissions';
import { AppEnv, Context, Hono } from 'hono';
import { PrismaD1 } from '@prisma/adapter-d1';
import { protect } from 'middlewares/auth.middleware';
import permissions from '../utils/permissions';
import { zValidator } from '@hono/zod-validator';
import next from 'middlewares/next.middleware';

// --- Station Reading ---

const getPrisma = (c: Context<AppEnv>) => {
    const adapter = new PrismaD1(c.env.DB);
    const prisma = new PrismaClient({ adapter });
    if (!prisma) throw new AppError('Internal server configuration error (Prisma).', 500);
    return prisma;
}

const stationRoutesController = new Hono<AppEnv>();

// Apply common middleware
stationRoutesController.use('*', protect); // Protect all and ensure Prisma

// ==============================
// Station Routes
// ==============================

stationRoutesController.get(
    '/:stationId',
    authorize([permissions.user.any]),
    zValidator('param', idParamSchema('stationId', 'posto').shape.params),
    async (c) => {
        const { stationId } = c.req.valid('param');
        try {
            const prisma = getPrisma(c);
            const station = await prisma.gasStation.findUnique({
                where: { id: stationId },
                select: { // Select all relevant fields including new address fields
                    id: true, name: true, latitude: true, longitude: true,
                    street: true, number: true, complement: true, neighborhood: true,
                    city: true, state: true, postalCode: true, country: true,
                    status: true, createdAt: true, updatedAt: true,
                    // Include relations if needed
                    // prices: { ... }
                }
            });
            if (!station) {
                return next(new AppError(`Posto com ID ${stationId} não encontrado.`, 404));
            }
            return c.json(station);
        } catch (error) {
            next(error);
        }
    }
);

stationRoutesController.get(
    '/:stationId/prices',
    authorize([permissions.user.any]),
    zValidator('param', idParamSchema('stationId', 'posto').shape.params),
    async (c) => {
        const { stationId } = c.req.valid('param');
        try {
            const prisma = getPrisma(c)
            // This query gets the *single most recent* price for *each* fuel type at the station.
            // It uses a raw query with window functions (like ROW_NUMBER) which is efficient in PostgreSQL.
            const latestPrices = await prisma.$queryRaw`
            SELECT DISTINCT ON ("fuelTypeId")
                sp.id,
                sp.price,
                sp."reportedAt",
                sp."fuelTypeId",
                ft.name as "fuelTypeName"
            FROM "station_prices" sp
            JOIN "fuel_types" ft ON sp."fuelTypeId" = ft.id
            WHERE sp."gasStationId" = ${stationId}
            -- Optional: Add filter to only consider prices from IMPLEMENTED proposals if needed
            ORDER BY "fuelTypeId", "reportedAt" DESC;
        `;

            // Check if station exists at all
            if (!latestPrices || (Array.isArray(latestPrices) && latestPrices.length === 0)) {
                const stationExists = await prisma.gasStation.findUnique({ where: { id: stationId }, select: { id: true } });
                if (!stationExists) {
                    return next(new AppError(`Posto com ID ${stationId} não encontrado.`, 404));
                }
            }

            return c.json(latestPrices);
        } catch (error) {
            next(error);
        }
    }
);



// --- Criação ---
// --- Criação/Report (Requer Login e Permissão Específica) ---
stationRoutesController.post(
    '/', // Cria novo posto (e proposta de revisão associada)
    authorize([permissions.user.any]),
    zValidator('json', createGasStationSchema.shape.body),
    async (c) => {
        const proposerId = c.get('user')!.id;
        const data = c.req.valid('json');

        try {
            const prisma = getPrisma(c);
            // TODO: Add check for existing nearby stations to prevent duplicates?

            const result = await prisma.$transaction(async (tx) => {
                // 1. Create GasStation with UNDER_REVIEW status
                const newStation = await tx.gasStation.create({
                    data: {
                        name: data.name,
                        latitude: data.latitude,
                        longitude: data.longitude,
                        // location: handled by trigger
                        street: data.street,
                        number: data.number,
                        complement: data.complement,
                        neighborhood: data.neighborhood,
                        city: data.city,
                        state: data.state.toUpperCase(),
                        postalCode: data.postalCode?.replace(/\D/g, ''), // Clean CEP
                        country: data.country,
                        status: GasStationStatus.UNDER_REVIEW, // Start as under review
                        // createdById: proposerId, // Optional: link creator directly
                    }
                });


                // 2. Create associated GasStationProposal
                const newStationProposal = await tx.gasStationProposal.create({
                    data: {
                        gasStationId: newStation.id,
                        proposerId: proposerId,
                        status: ReviewStatus.PENDING, // Starts pending review
                        reasonType: ProposalReasonType.INITIAL_CREATION,
                        reason: data.reason // Pass optional reason from input
                    }
                });

                const newStationPrices = await tx.stationPrice.createManyAndReturn({
                    data: data.stationPrices.map(item => {
                        return {
                            ...item,
                            gasStationId: newStation.id,
                            reportedById: proposerId
                        } as any
                    })
                });

                const newStationPricesProposal = await tx.stationPriceProposal.createManyAndReturn({
                    data: newStationPrices.map(item => {
                        return {
                            stationPriceId: item.id,
                            proposerId: proposerId,
                            reasonType: ProposalReasonType.INITIAL_CREATION,
                        }
                    })
                });

                return { newStation, newStationProposal, newStationPrices, newStationPricesProposal };
            });

            // Return only station data, proposal ID is internal for review process
            return c.json(result, 201);

        } catch (error) {
            // Handle potential unique constraint errors if name check is added
            next(error);
        }
    }
);

stationRoutesController.post(
    '/:stationId/prices', // Reporta novo preço (cria preço e proposta associada)
    zValidator('param', reportStationPriceSchema.shape.params),
    zValidator('json', reportStationPriceSchema.shape.body),
    async (c) => {
        const reporterId = c.get('user').id;
        const { stationId } = c.req.valid('param');
        const { fuelTypeId, price, reason } = c.req.valid('json');

        try {
            const prisma = getPrisma(c)
            // 1. Verify station exists and maybe is ACTIVE? Or allow reporting for UNDER_REVIEW?
            const station = await prisma.gasStation.findUnique({
                where: { id: stationId }, select: { id: true, status: true }
            });

            if (!station) {
                return next(new AppError(`Posto ${stationId} não encontrado.`, 404));
            }
            // Optional: Restrict reporting only to ACTIVE stations?
            // if (station.status !== GasStationStatus.ACTIVE) {
            //    return next(new AppError(`Só é possível reportar preços para postos ativos.`, 400));
            // }

            // 2. Verify fuel type exists
            const fuelType = await prisma.fuelType.findUnique({ where: { id: fuelTypeId }, select: { id: true } });
            if (!fuelType) {
                return next(new AppError(`Tipo de combustível ${fuelTypeId} não encontrado.`, 400));
            }

            // 3. Create Price and Proposal in Transaction
            const result = await prisma.$transaction(async (tx) => {
                // a. Create StationPrice with UNDER_REVIEW status
                const newPrice = await tx.stationPrice.create({
                    data: {
                        reportedById: reporterId,
                        gasStationId: stationId,
                        fuelTypeId: fuelTypeId,
                        price: new Decimal(price),
                        status: StationPriceStatus.UNDER_REVIEW, // Start as under review
                        reportedAt: new Date(), // Explicit timestamp
                    }
                });

                // b. Create associated StationPriceProposal
                const proposal = await tx.stationPriceProposal.create({
                    data: {
                        stationPriceId: newPrice.id,
                        proposerId: reporterId, // Same as reportedBy
                        status: ReviewStatus.PENDING,
                        reasonType: ProposalReasonType.INITIAL_CREATION, // Default is fine here
                        reason: reason
                    }
                });
                return { newPrice, proposal };
            });

            // Return only price data
            return c.json(result.newPrice);

        } catch (error) {
            next(error);
        }
    }
);


// --- Leitura ---
stationRoutesController.get(
    '/',
    zValidator('query', getStationsSchema.shape.query),
    async (c) => {
        const { latitude, longitude, radius, status: statusFilter, name } = c.req.valid('query');

        try {
            const prisma = getPrisma(c);
            const userPermissions = await getPermissionsForRole(c.get('user').roleId, prisma); // Assumes helper from authorize middleware context
            const where: Prisma.GasStationWhereInput = {};

            // --- Filtragem por Status Baseada em Permissão ---
            const canReadAll = userPermissions.has(PERMISSION.user.any);
            if (!canReadAll) {
                // Usuário comum só vê ativos por padrão
                where.status = GasStationStatus.ACTIVE;
            }
            // Se admin/revisor usou filtro de status explícito, aplica-o
            if (canReadAll && statusFilter) {
                where.status = statusFilter;
            }

            // --- Fim da Filtragem por Status ---


            let stations;
            if (latitude !== undefined && longitude !== undefined && radius !== undefined) {
                // Raw query para busca espacial (Ajustar SELECT e adicionar WHERE para status)
                const userLocation = Prisma.sql`ST_SetSRID(ST_MakePoint(${longitude}, ${latitude}), 4326)::geometry`;
                const radiusInMeters = radius * 1000;

                // Construir a cláusula WHERE dinamicamente para a query raw
                let statusClause = Prisma.sql`status = ${GasStationStatus.ACTIVE}`; // Default for non-admins
                if (canReadAll) {
                    statusClause = statusFilter ? Prisma.sql`status = ${statusFilter}` : Prisma.sql`1=1`; // Se admin e sem filtro, busca todos
                }

                stations = await prisma.$queryRaw`
                SELECT
                    id, name, latitude, longitude,
                    street, number, complement, neighborhood, city, state, "postalCode", country,
                    status, ST_Distance(location_geom, ${userLocation}) as distance_meters
                FROM "gas_stations"
                WHERE ST_DWithin(location_geom, ${userLocation}, ${radiusInMeters})
                  AND ${statusClause} -- Aplicar filtro de status
                ORDER BY distance_meters ASC;
            `;
                // Clean up potential null complement...
            } else {
                // Busca normal com where clause montado acima
                stations = await prisma.gasStation.findMany({
                    where: { ...where, name: { contains: name } },
                    orderBy: { name: 'asc' },
                    select: {
                        id: true,
                        name: true,
                        latitude: true,
                        longitude: true,
                        street: true,
                        number: true,
                        complement: true,
                        neighborhood: true,
                        city: true,
                        state: true,
                        postalCode: true,
                        country: true,
                        status: true,
                        createdAt: true,
                        updatedAt: true,
                        // For nearby search
                        // distance_meters: true, // If returned by raw query
                        prices: {
                            select: {
                                id: true,
                                price: true,
                                reportedAt: true,
                                fuelTypeId: true,
                                fuelType: { select: { name: true } },
                                status: true,
                            }
                        },
                    }
                });
            }

            return c.json(stations);
        } catch (error) {
            next(error);
        }
    }
);

// --- NOVO: Propor Edição para Posto Existente ---
stationRoutesController.post(
    '/:stationId/propose-edit', // <<< Nova Rota
    authorize([PERMISSION.user.any]), // <<< Permissão necessária
    zValidator('param', proposeEditStationSchema.shape.params),
    zValidator('json', proposeEditStationSchema.shape.body),
    async (c) => {
        const proposerId = c.get('user').id;
        const { stationId } = c.req.valid('param');
        const { reason, stationPrices, ...proposedChanges } = c.req.valid('json'); // Separa razão das mudanças

        try {
            const prisma = getPrisma(c);
            // 1. Verifica se o posto existe e está em um estado editável (ex: ACTIVE)
            const station = await prisma.gasStation.findUnique({
                where: { id: stationId },
                select: { id: true, status: true }
            });
            if (!station) {
                return next(new AppError(`Posto ${stationId} não encontrado.`, 404));
            }
            // Opcional: Permitir editar apenas postos ATIVOS?
            // if (station.status !== GasStationStatus.ACTIVE) {
            //     return next(new AppError(`Só é possível propor edições para postos ativos.`, 400));
            // }

            // 2. Verifica se já existe uma proposta de EDIÇÃO pendente para este posto
            // const existingPendingEditProposal = await prisma.gasStationProposal.findFirst({
            //     where: {
            //         gasStationId: stationId,
            //         status: ReviewStatus.PENDING,
            //         reasonType: ProposalReasonType.DATA_UPDATE, // Procura especificamente por propostas de edição
            //     }
            // });
            // if (existingPendingEditProposal) {
            //     return next(new AppError(`Já existe uma proposta de edição pendente para este posto. Aguarde a resolução.`, 409));
            // }

            // 3. Cria a nova proposta de edição
            const proposal = await prisma.gasStationProposal.create({
                data: {
                    gasStationId: stationId,
                    proposerId: proposerId,
                    status: ReviewStatus.PENDING,
                    reasonType: ProposalReasonType.DATA_UPDATE, // <<< Define o tipo como edição
                    proposedData: proposedChanges as any, // <<< Armazena as mudanças propostas
                    reason: reason, // Justificativa da edição
                },
                select: { id: true, status: true, reasonType: true, createdAt: true } // Retorna dados da proposta
            });

            const priceProposal = await prisma.stationPriceProposal.createManyAndReturn({
                data: stationPrices.map(item => {
                    return {
                        proposerId: proposerId,
                        ...item,
                        reasonType: ProposalReasonType.DATA_UPDATE,
                    } as any
                })
            });

            const response = {
                proposal,
                priceProposal
            };

            return c.json({ message: "Proposta de edição enviada para revisão.", response });

        } catch (error) {
            next(error);
        }
    }
);


export default stationRoutesController;