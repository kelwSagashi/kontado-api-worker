// src/controllers/expense.controller.ts

import { AppEnv, Hono } from 'hono';
import { prismaMiddleware } from '../middlewares/prisma.middleware'; // Adjust path
import { protect } from '../middlewares/auth.middleware'; // Adjust path
import { authorize } from '../middlewares/authorize.middleware'; // Adjust path
import next from '../middlewares/next.middleware'; // Adjust path *** IMPORT CUSTOM NEXT ***
import permissions from '../utils/permissions'; // Adjust path
import AppError from '../utils/AppError';
import { Prisma, PrismaClient, GeneralExpense, Fueling } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import vehicleRoutesController, { checkVehicleAccess } from './vehicle.controller';
import { Context } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { createFuelingSchema, createGeneralExpenseSchema, fuelingIdParamSchema, generalExpenseIdParamSchema, listFuelingsSchema, listGeneralExpensesSchema, updateFuelingSchema, updateGeneralExpenseSchema } from 'validators/expense.validator';
import { fuelTypeIdParamSchema } from 'validators/fuelType.validator';
import { PrismaD1 } from '@prisma/adapter-d1';


export async function getLatestStationPrice(prisma: PrismaClient, stationId: string, fuelTypeId: string): Promise<Decimal | null> {
    const priceResult = await prisma.stationPrice.findFirst({
        where: {
            gasStationId: stationId,
            fuelTypeId: fuelTypeId,
        },
        orderBy: { reportedAt: 'desc' },
        select: { price: true }
    });
    return priceResult?.price ?? null;
}

// --- Helper Function for Specific Expense Access ---
type ExpenseType = 'general' | 'fueling';
// Use specific return types for better type safety where possible
type KnownExpense = (GeneralExpense & { vehicleId: string }) | (Fueling & { vehicleId: string });

export async function checkExpenseAccess(
    prisma: PrismaClient,
    userId: string,
    expenseId: string,
    expenseType: ExpenseType
): Promise<KnownExpense> { // Return type can be refined if needed
    let expense: KnownExpense | null = null;
    let entityName = '';

    if (expenseType === 'general') {
        entityName = 'Gasto Geral';
        expense = await prisma.generalExpense.findUnique({ where: { id: expenseId } });
    } else if (expenseType === 'fueling') {
        entityName = 'Abastecimento';
        expense = await prisma.fueling.findUnique({ where: { id: expenseId } });
    }

    if (!expense) {
        throw new AppError(`${entityName} com ID ${expenseId} não encontrado(a).`, 404);
    }

    // Ensure vehicleId exists before checking access
    if (!expense.vehicleId) {
        console.error(`Consistency error: Expense ${expenseId} (${expenseType}) has no vehicleId.`);
        throw new AppError(`Erro interno: Gasto/abastecimento sem veículo associado.`, 500);
    }

    const hasVehicleAccess = await checkVehicleAccess(prisma, userId, expense.vehicleId);
    if (!hasVehicleAccess) {
        console.warn(`Forbidden access attempt: User ${userId} tried to access ${expenseType} expense ${expenseId} via vehicle ${expense.vehicleId}`);
        throw new AppError(`Acesso proibido ao veículo associado a este gasto/abastecimento.`, 403);
    }

    return expense;
}



// --- Context Helpers ---
const getPrisma = (c: Context<AppEnv>) => {
    const adapter = new PrismaD1(c.env.DB);
    const prisma = new PrismaClient({ adapter });
    if (!prisma) throw new AppError('Internal server configuration error (Prisma).', 500);
    return prisma;
}

const getUser = (c: Context<AppEnv>) => {
    const user = c.get('user');
    if (!user) throw new AppError('Usuário não autenticado.', 401);
    return user;
}
// ---

const expenseRoutesController = new Hono<AppEnv>();

// Apply common middleware
expenseRoutesController.use('*', protect, prismaMiddleware); // Protect all and ensure Prisma

// ==============================
// General Expense Routes
// ==============================

// --- POST /general/:vehicleId (Create General Expense) ---
vehicleRoutesController.post(
    '/:vehicleId/expenses/general',
    authorize([permissions.expense.create]),
    zValidator('param', createGeneralExpenseSchema.shape.params), // Validate param first
    zValidator('json', createGeneralExpenseSchema.shape.body),   // Then validate body
    async (c) => {
        const prisma = getPrisma(c);
        const userId = getUser(c).id;
        const { vehicleId } = c.req.valid('param');
        const { cost, categoryId, ...restData } = c.req.valid('json');

        try {
            // 1. Check vehicle access
            const hasAccess = await checkVehicleAccess(prisma, userId, vehicleId);
            // *** USING CUSTOM next as requested ***
            if (!hasAccess) return next(new AppError('Acesso negado ou veículo não encontrado.', 403));

            // 2. Validate CategoryId exists
            const categoryExists = await prisma.expenseCategory.findUnique({
                where: { id: categoryId }, select: { id: true },
            });
            // *** USING CUSTOM next as requested ***
            if (!categoryExists) return next(new AppError(`Categoria de gasto com ID ${categoryId} não encontrada.`, 400));
            
            // 3. Create General Expense
            const newExpense = await prisma.generalExpense.create({
                data: {
                    description: restData.description ?? '',
                    notes: restData.notes ?? '',
                    cost: new Decimal(cost), // Convert validated number
                    expenseDate: new Date(restData.expenseDate), // Use validated Date object
                    categoryId: categoryId,
                    vehicleId: vehicleId,
                    userId: userId,
                },
                include: { category: true, user: { select: { id: true, username: true } } }
            });

            return c.json(newExpense, 201);

        } catch (error) {
            next(error);
        }
    }
);

// --- GET /general/:vehicleId (List General Expenses) ---
vehicleRoutesController.get(
    '/:vehicleId/expenses/general',
    authorize([permissions.expense.read]),
    zValidator('param', listGeneralExpensesSchema.shape.params),
    zValidator('query', listGeneralExpensesSchema.shape.query),
    async (c) => {
        const prisma = getPrisma(c);
        const user = getUser(c);
        const { vehicleId } = c.req.valid('param');
        const query = c.req.valid('query');
        const { categoryId, dateStart, dateEnd, limit } = query ?? {};

        // 1. Check vehicle access
        const hasAccess = await checkVehicleAccess(prisma, user.id, vehicleId);
        // *** USING CUSTOM next as requested ***
        if (!hasAccess) return next(new AppError('Acesso negado ou veículo não encontrado.', 403));

        try {
            // 2. Build query filters
            const where: Prisma.GeneralExpenseWhereInput = {
                vehicleId: vehicleId,
                ...(categoryId && { categoryId: categoryId }),
                // Combine date ranges correctly
                ...(dateStart && dateEnd && { expenseDate: { gte: dateStart, lte: dateEnd } }),
                ...(dateStart && !dateEnd && { expenseDate: { gte: dateStart } }),
                ...(!dateStart && dateEnd && { expenseDate: { lte: dateEnd } }),
            };

            // 3. Fetch expenses
            const expenses = await prisma.generalExpense.findMany({
                where: where,
                ...(limit && { take: Number(limit) }), // Ensure limit is a number
                orderBy: { expenseDate: 'desc' },
                include: {
                    category: { select: { name: true, iconName: true } },
                    user: { select: { id: true, username: true } },
                    vehicle: { select: { id: true, alias: true } }
                }
            });

            return c.json(expenses, 200);
        } catch (error) {
            next(error);
        }
    }
);

// --- GET /general/detail/:expenseId (Get General Expense By ID) ---
expenseRoutesController.get(
    '/general/detail/:expenseId',
    authorize([permissions.expense.read]),
    zValidator('param', generalExpenseIdParamSchema.shape.params),
    async (c) => {
        const prisma = getPrisma(c);
        const user = getUser(c);
        const { expenseId } = c.req.valid('param');

        try {
            // checkExpenseAccess handles existence and vehicle access check
            // It throws AppError on failure, caught by the global handler
            await checkExpenseAccess(prisma, user.id, expenseId, 'general');

            const detailedExpense = await prisma.generalExpense.findUnique({
                where: { id: expenseId },
                include: {
                    category: true,
                    user: { select: { id: true, username: true } },
                    vehicle: { select: { id: true, alias: true } }
                }
            });

            // Check if found (could be null if deleted between checks, though unlikely)
            if (!detailedExpense) throw new AppError('Gasto geral não encontrado.', 404);

            return c.json(detailedExpense, 200);
        } catch (error) {
            next(error);
        }
    }
);

// --- PATCH /general/detail/:expenseId (Update General Expense) ---
expenseRoutesController.patch(
    '/general/detail/:expenseId',
    authorize([permissions.expense.update]),
    zValidator('param', updateGeneralExpenseSchema.shape.params),
    zValidator('json', updateGeneralExpenseSchema.shape.body),
    async (c) => {
        const prisma = getPrisma(c);
        const user = getUser(c);
        const { expenseId } = c.req.valid('param');
        const { cost, categoryId, expenseDate, ...restData } = c.req.valid('json');

        try {
            // 1. Check access via helper (throws on failure)
            await checkExpenseAccess(prisma, user.id, expenseId, 'general');

            // 2. Validate new CategoryId if provided
            if (categoryId) {
                const categoryExists = await prisma.expenseCategory.findUnique({
                    where: { id: categoryId }, select: { id: true },
                });
                // *** USING CUSTOM next as requested ***
                if (!categoryExists) return next(new AppError(`Categoria de gasto com ID ${categoryId} não encontrada.`, 400));
            }

            // 3. Prepare data for update
            const dataToUpdate: Prisma.GeneralExpenseUpdateInput = {
                ...restData, // Includes description, notes (nullable)
                ...(categoryId && { category: { connect: { id: categoryId } } }),
                ...(cost !== undefined && { cost: new Decimal(cost) }),
                ...(expenseDate !== undefined && { expenseDate: expenseDate }), // Use validated Date
            };

            // 4. Update
            const updatedExpense = await prisma.generalExpense.update({
                where: { id: expenseId },
                data: dataToUpdate,
                include: { category: true, user: { select: { id: true, username: true } } }
            });

            return c.json(updatedExpense, 200);

        } catch (error) {
            next(error);
        }
    }
);

// --- DELETE /general/detail/:expenseId (Delete General Expense) ---
expenseRoutesController.delete(
    '/general/detail/:expenseId',
    authorize([permissions.expense.delete]),
    zValidator('param', generalExpenseIdParamSchema.shape.params),
    async (c) => {
        const prisma = getPrisma(c);
        const user = getUser(c);
        const { expenseId } = c.req.valid('param');

        try {
            // 1. Check access via helper (throws on failure)
            await checkExpenseAccess(prisma, user.id, expenseId, 'general');

            // 2. Delete
            await prisma.generalExpense.delete({ where: { id: expenseId } });

            return c.body(null, 204); // No Content
        } catch (error) {
            next(error)
        }
    }
);


// ==============================
// Fueling Routes
// ==============================

// --- POST /fueling/:vehicleId (Create Fueling) ---
vehicleRoutesController.post(
    '/:vehicleId/expenses/fueling',
    authorize([permissions.expense.create]),
    zValidator('param', createFuelingSchema.shape.params),
    zValidator('json', createFuelingSchema.shape.body),
    async (c) => {
        const prisma = getPrisma(c);
        const user = getUser(c);
        const { vehicleId } = c.req.valid('param');
        const {
            cost, fuelTypeId, timestamp, latitude, longitude,
            pricePerLiter: inputPricePerLiter, gasStationId
        } = c.req.valid('json');

        try {
            // 1. Check vehicle access
            const hasAccess = await checkVehicleAccess(prisma, user.id, vehicleId);
            // *** USING CUSTOM next as requested ***
            if (!hasAccess) return next(new AppError('Acesso negado ou veículo não encontrado.', 403));

            // 2. Validate FuelTypeId exists
            const fuelTypeExists = await prisma.fuelType.findUnique({
                where: { id: fuelTypeId }, select: { id: true },
            });
            // *** USING CUSTOM next as requested ***
            if (!fuelTypeExists) return next(new AppError(`Tipo de combustível com ID ${fuelTypeId} não encontrado.`, 400));

            // 3. Determine final price per liter based on station/input
            let finalPricePerLiter: Decimal | null = null;
            if (gasStationId) {
                const stationExists = await prisma.gasStation.findUnique({
                    where: { id: gasStationId }, select: { id: true, status: true },
                });
                // *** USING CUSTOM next as requested ***
                if (!stationExists) return next(new AppError(`Posto de combustível com ID ${gasStationId} não encontrado.`, 400));

                const stationPrice = await getLatestStationPrice(prisma, gasStationId, fuelTypeId);
                if (stationPrice) {
                    finalPricePerLiter = stationPrice;
                    // Optional: Log mismatch without stopping execution
                    if (inputPricePerLiter !== undefined && !stationPrice.equals(inputPricePerLiter)) {
                        console.warn(`User price ${inputPricePerLiter} differs from station price ${stationPrice} for station ${gasStationId}. Using station price.`);
                    }
                } else {
                    // Station exists, no price found, inputPrice is required by validator refine
                    finalPricePerLiter = new Decimal(inputPricePerLiter!); // Use non-null assertion as validator ensures it exists
                }
            } else {
                // No station, inputPrice is required by validator refine
                finalPricePerLiter = new Decimal(inputPricePerLiter!); // Use non-null assertion
            }

            // Safeguard after logic
            if (!finalPricePerLiter || !finalPricePerLiter.isPositive()) {
                console.error("Failed to determine a valid positive price per liter.", { gasStationId, inputPricePerLiter, finalPricePerLiter });
                throw new AppError('Não foi possível determinar um preço por litro válido.', 500);
            }

            // 4. Prepare data and calculate volume
            const costDecimal = new Decimal(cost);
            const finalVolume = costDecimal.dividedBy(finalPricePerLiter).toNumber(); // Calculate volume

            if (finalVolume === null || finalVolume < 0 || !Number.isFinite(finalVolume)) {
                console.error("Failed to calculate a valid fueling volume.", { cost, finalPricePerLiter, finalVolume });
                throw new AppError('Falha ao determinar o volume do abastecimento (custo/preço inválido?).', 500);
            }

            const vehicle = await prisma.vehicle.findUnique({
                where: { id: vehicleId },
                select: { id: true, appFuelTank: true }
            });
            // *** USING CUSTOM next as requested *** (Or throw AppError)
            if (!vehicle) return next(new AppError(`Veiculo com ID ${vehicleId} não encontrado.`, 400));


            // 5. Create Fueling record and update tank in transaction
            const result = await prisma.$transaction(async (tx) => {
                const newFueling = await tx.fueling.create({
                    data: {
                        cost: costDecimal,
                        pricePerLiter: finalPricePerLiter,
                        timestamp: timestamp ?? new Date(), // Use provided or current date
                        latitude: latitude,
                        longitude: longitude,
                        // volume: finalVolume, // Store calculated volume
                        fuelTypeId: fuelTypeId,
                        vehicleId: vehicleId,
                        userId: user.id,
                        gasStationId: gasStationId ?? null,
                        momentAppFuelTank: vehicle.appFuelTank // Store tank level *before* update
                    },
                    include: {
                        fuelType: true,
                        user: { select: { id: true, username: true } },
                        gasStation: { select: { id: true, name: true } }
                    }
                });

                // Update vehicle tank (atomic increment)
                await tx.vehicle.update({
                    where: { id: vehicleId },
                    data: { appFuelTank: { increment: finalVolume } }
                });

                return newFueling;
            });

            return c.json(result, 201);

        } catch (error) {
            next(error);
        }
    }
);


// GET /api/vehicles/:vehicleId/expenses/fueling - List fuelings for a vehicle
vehicleRoutesController.get(
    '/:vehicleId/expenses/fueling',
    authorize([permissions.expense.read]),
    zValidator('param', listFuelingsSchema.shape.params),
    zValidator('query', listFuelingsSchema.shape.query),
    async (c) => {
        const prisma = getPrisma(c);
        const user = getUser(c);
        const { vehicleId } = c.req.valid('param');
        const query = c.req.valid('query');
        const { fuelTypeId, dateStart, dateEnd } = query ?? {};

        // 1. Check vehicle access
        const hasAccess = await checkVehicleAccess(prisma, user.id, vehicleId);
        // *** USING CUSTOM next as requested ***
        if (!hasAccess) return next(new AppError('Acesso negado ou veículo não encontrado.', 403));

        try {
            // 2. Build query filters
            const where: Prisma.FuelingWhereInput = {
                vehicleId: vehicleId,
                ...(fuelTypeId && { fuelTypeId: fuelTypeId }),
                ...(dateStart && dateEnd && { timestamp: { gte: dateStart, lte: dateEnd } }),
                ...(dateStart && !dateEnd && { timestamp: { gte: dateStart } }),
                ...(!dateStart && dateEnd && { timestamp: { lte: dateEnd } }),
            };

            // 3. Fetch fuelings
            const fuelings = await prisma.fueling.findMany({
                where: where,
                orderBy: { timestamp: 'desc' },
                include: {
                    vehicle: { select: { id: true, alias: true } },
                    fuelType: { select: { name: true } },
                    user: { select: { id: true, username: true } },
                    gasStation: { select: { id: true, name: true } },
                }
                // Add pagination (limit/skip) here if needed, using validated query params
            });

            return c.json(fuelings, 200);
        } catch (error) {
            next(error);
        }
    }
);

// --- GET /fueling/detail/:fuelingId (Get Fueling By ID) ---
expenseRoutesController.get(
    '/fueling/:fuelingId',
    authorize([permissions.expense.read]),
    zValidator('param', fuelingIdParamSchema.shape.params),
    async (c) => {
        const adapter = new PrismaD1(c.env.DB);
        const prisma = new PrismaClient({ adapter });
        const user = getUser(c);
        const { fuelingId } = c.req.valid('param');


        try {
            // checkExpenseAccess handles existence and vehicle access check
            await checkExpenseAccess(prisma, user.id, fuelingId, 'fueling');


            const detailedFueling = await prisma.fueling.findUnique({
                where: { id: fuelingId },
                include: {
                    fuelType: true,
                    user: { select: { id: true, username: true } },
                    vehicle: { select: { id: true, alias: true } },
                    gasStation: { select: { id: true, name: true } }
                }
            });

            if (!detailedFueling) throw new AppError('Abastecimento não encontrado.', 404);

            return c.json(detailedFueling);
        } catch (error) {
            next(error);
        }
    }
);

// --- PATCH /fueling/detail/:fuelingId (Update Fueling) ---
expenseRoutesController.patch(
    '/fueling/:fuelingId',
    authorize([permissions.expense.update]),
    zValidator('param', updateFuelingSchema.shape.params),
    zValidator('json', updateFuelingSchema.shape.body),
    async (c) => {
        const prisma = getPrisma(c);
        const user = getUser(c);
        const { fuelingId } = c.req.valid('param');
        const {
            cost, pricePerLiter, timestamp, fuelTypeId,
            gasStationId, latitude, longitude
        } = c.req.valid('json');

        // 1. Check access (Simplified - doesn't use checkExpenseAccess for update as per original logic)
        const currentFueling = await prisma.fueling.findUnique({
            where: { id: fuelingId },
            // Include enough info to check ownership/authorization via vehicle relation
            include: { vehicle: { select: { ownerId: true, authorizedUsers: { where: { userId: user.id }, select: { userId: true } } } } }
        });
        // *** USING CUSTOM next as requested ***
        if (!currentFueling) return next(new AppError(`Abastecimento ${fuelingId} não encontrado.`, 404));
        const vehicle = currentFueling.vehicle;
        // *** USING CUSTOM next as requested ***
        if (!vehicle || (vehicle.ownerId !== user.id && vehicle.authorizedUsers.length === 0)) {
            return next(new AppError(`Acesso proibido a este abastecimento.`, 403));
        }

        try {
            // 2. Prepare data - handle relations and type conversions
            const dataToUpdate: Prisma.FuelingUpdateInput = {};
            if (cost !== undefined) dataToUpdate.cost = new Decimal(cost);
            if (pricePerLiter !== undefined) dataToUpdate.pricePerLiter = new Decimal(pricePerLiter);
            if (timestamp !== undefined) dataToUpdate.timestamp = timestamp; // Already Date obj
            if (latitude !== undefined) dataToUpdate.latitude = latitude;
            if (longitude !== undefined) dataToUpdate.longitude = longitude;

            if (fuelTypeId !== undefined) {
                const exists = await prisma.fuelType.findUnique({ where: { id: fuelTypeId }, select: { id: true } });
                // *** USING CUSTOM next as requested ***
                if (!exists) return next(new AppError(`Tipo combustível ${fuelTypeId} não encontrado.`, 400));
                dataToUpdate.fuelType = { connect: { id: fuelTypeId } };
            }
            if (gasStationId !== undefined) { // Check if key exists (could be null)
                if (gasStationId === null) {
                    dataToUpdate.gasStation = { disconnect: true };
                } else {
                    const exists = await prisma.gasStation.findUnique({ where: { id: gasStationId }, select: { id: true } });
                    // *** USING CUSTOM next as requested ***
                    if (!exists) return next(new AppError(`Posto ${gasStationId} não encontrado.`, 400));
                    dataToUpdate.gasStation = { connect: { id: gasStationId } };
                }
            }
            // NOTE: Volume recalculation on update is omitted for simplicity, as in original code.

            // 3. Update
            const updatedFueling = await prisma.fueling.update({
                where: { id: fuelingId },
                data: dataToUpdate,
                include: { fuelType: true, user: { select: { id: true, username: true } }, gasStation: { select: { id: true, name: true } } }
            });

            return c.json(updatedFueling, 200);
        } catch (error) {
            next(error);
        }
    }
);


// --- DELETE /fueling/detail/:fuelingId (Delete Fueling) ---
expenseRoutesController.delete(
    '/fueling/:fuelingId',
    authorize([permissions.expense.delete]),
    zValidator('param', fuelingIdParamSchema.shape.params),
    async (c) => {
        const prisma = getPrisma(c);
        const user = getUser(c);
        const { fuelingId } = c.req.valid('param');

        try {
            // 1. Check access via helper (throws on failure)
            await checkExpenseAccess(prisma, user.id, fuelingId, 'fueling');

            // TODO: Consider transaction to also *subtract* volume from vehicle's appFuelTank?
            // This makes delete more complex but maintains tank accuracy.
            // For now, just delete the record as per original logic.

            // 2. Delete
            await prisma.fueling.delete({ where: { id: fuelingId } });

            return c.body(null, 204); // No Content
        } catch (error) {
            next(error);
        }
    }
);


// ==============================
// Category Route
// ==============================

// --- GET /categories (List Expense Categories) ---
expenseRoutesController.get(
    '/categories',
    authorize([permissions.user.any]),
    // Authorization? Usually all logged-in users can see categories.
    // authorize([permissions.expense.read]), // Or a more general permission if needed
    async (c) => {
        const prisma = getPrisma(c);

        try {
            const categories = await prisma.expenseCategory.findMany({
                orderBy: { name: 'asc' },
                select: { id: true, name: true, iconName: true, createdAt: true, updatedAt: true }
            });
            return c.json(categories, 200);
        } catch (error) {
            if (error instanceof AppError) throw error;
            console.error("Error listing expense categories:", error);
            throw new AppError('Erro ao listar categorias de gastos.', 500);
        }
    }
);


export default expenseRoutesController;