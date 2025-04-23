// src/controllers/budget.controller.ts

import AppError from '../utils/AppError';
import { Prisma, PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { AppEnv, Hono } from 'hono';
import { protect } from 'middlewares/auth.middleware';
import { prismaMiddleware } from 'middlewares/prisma.middleware';
import { zValidator } from '@hono/zod-validator';
import { budgetIdParamSchema, createBudgetSchema, listBudgetsSchema, updateBudgetSchema } from 'validators/budget.validator';
import permissions from 'utils/permissions';
import { authorize } from 'middlewares/authorize.middleware';
import next from 'middlewares/next.middleware';
import { checkVehicleAccess } from './vehicle.controller';

// --- Helper: Verifica propriedade e existência do orçamento ---
async function checkBudgetOwnership(prisma: PrismaClient, userId: string, budgetId: string): Promise<Prisma.BudgetGetPayload<{}>> {
    const budget = await prisma.budget.findUnique({
        where: { id: budgetId },
    });
    if (!budget) {
        throw new AppError(`Orçamento com ID ${budgetId} não encontrado.`, 404);
    }
    if (budget.userId !== userId) {
        throw new AppError('Acesso não autorizado a este orçamento.', 403);
    }
    return budget;
}

const budgetRoutesController = new Hono<AppEnv>();

// Apply common middleware
budgetRoutesController.use('*', protect, prismaMiddleware);

// --- CRUD ---
budgetRoutesController.post(
    '/',
    authorize([permissions.budget.create]),
    zValidator('json', createBudgetSchema.shape.body),
    async (req) => {

        try {
            const userId = req.get('user')!.id;
            const { vehicleId, amount, ...restData } = req.req.valid('json');
            const prisma = req.get('prisma');
            // Valida vehicleId se fornecido
            if (vehicleId) {
                // Verifica se o veículo existe E se o usuário tem acesso a ele
                const vehicleAccess = await checkVehicleAccess(prisma, userId, vehicleId); // Usa helper existente
                if (!vehicleAccess) {
                    return next(new AppError(`Veículo ${vehicleId} não encontrado ou acesso negado.`, 404)); // 404 ou 403
                }
            }

            const newBudget = await prisma.budget.create({
                data: {
                    ...restData,
                    amount: new Decimal(amount),
                    startDate: new Date(restData.startDate), // Garante tipo Date
                    endDate: new Date(restData.endDate),
                    userId: userId,
                    vehicleId: vehicleId ?? null, // Define como null se não fornecido
                },
                include: { vehicle: { select: { id: true, alias: true } } } // Inclui veículo se associado
            });

            return req.json(newBudget, 201);
        } catch (error) {
            next(error);
        }
    }
);

budgetRoutesController.get(
    '/',
    authorize([permissions.budget.read]),
    zValidator('query', listBudgetsSchema.shape.query),
    async (req) => {

        try {
            const userId = req.get('user')!.id;
            const { vehicleId, activeOnDate, page = 1, limit = 10 } = req.req.valid('query') ?? {};
            const prisma = req.get('prisma');

            const skip = (page - 1) * limit;
            const where: Prisma.BudgetWhereInput = {
                userId: userId, // Apenas orçamentos do usuário logado
            };

            if (vehicleId) {
                where.vehicleId = vehicleId;
            }
            if (activeOnDate) {
                // Encontra orçamentos cujo período inclui a data fornecida
                where.startDate = { lte: activeOnDate }; // Data início <= data ativa
                where.endDate = { gte: activeOnDate }; // Data fim >= data ativa
            }

            const [budgets, totalCount] = await prisma.$transaction([
                prisma.budget.findMany({
                    where: where,
                    include: {
                        vehicle: { select: { id: true, alias: true } } // Inclui info do veículo se houver
                    },
                    orderBy: { startDate: 'desc' }, // Ou outra ordenação
                    skip: skip,
                    take: limit,
                }),
                prisma.budget.count({ where: where })
            ]);

            return req.json({
                data: budgets,
                meta: { currentPage: page, pageSize: limit, totalItems: totalCount, totalPages: Math.ceil(totalCount / limit) }
            }, 200);

        } catch (error) {
            next(error);
        }
    }
);

budgetRoutesController.get(
    '/:budgetId',
    authorize([permissions.budget.read]),
    zValidator('param', budgetIdParamSchema.shape.params),
    async (req) => {

        try {
            const userId = req.get('user')!.id;
            const { budgetId } = req.req.valid('param');
            const prisma = req.get('prisma');
            const budget = await checkBudgetOwnership(prisma, userId, budgetId); // Verifica propriedade e busca

            // Busca novamente com includes, ou ajusta checkBudgetOwnership para incluir
            const detailedBudget = await prisma.budget.findUnique({
                where: { id: budgetId },
                include: {
                    user: { select: { id: true, username: true } },
                    vehicle: { select: { id: true, alias: true, plate: true } }
                }
            });

            return req.json(detailedBudget, 200);
        } catch (error) {
            next(error); // Passa 404/403 do helper
        }
    }
);

// --- PATCH /:budgetId (Update Budget) ---
budgetRoutesController.patch(
    '/:budgetId',
    authorize([permissions.budget.update]),
    zValidator('param', updateBudgetSchema.shape.params),
    zValidator('json', updateBudgetSchema.shape.body),  // Then validate body
    async (c) => {
        const prisma = c.get('prisma');
        const user = c.get('user');
        const { budgetId } = c.req.valid('param');
        const { vehicleId, amount, startDate, endDate, ...restData } = c.req.valid('json');

        try {
            // 1. Verify ownership
            await checkBudgetOwnership(prisma, user.id, budgetId);

            // 2. Validate new vehicleId if changing
            let vehicleConnectDisconnect: Prisma.BudgetUpdateInput['vehicle'] = undefined;
            if (vehicleId !== undefined) { // Check if key exists in payload
                if (vehicleId === null) {
                    vehicleConnectDisconnect = { disconnect: true };
                } else {
                    const vehicleAccess = await checkVehicleAccess(prisma, user.id, vehicleId);
                    if (!vehicleAccess) {
                        throw new AppError(`Veículo ${vehicleId} não encontrado ou acesso negado.`, 404);
                    }
                    vehicleConnectDisconnect = { connect: { id: vehicleId } };
                }
            }

            // 3. Prepare update data
            const dataToUpdate: Prisma.BudgetUpdateInput = {
                ...restData,
                ...(amount !== undefined && { amount: new Decimal(amount) }),
                ...(startDate !== undefined && { startDate: new Date(startDate) }),
                ...(endDate !== undefined && { endDate: new Date(endDate) }),
                ...(vehicleConnectDisconnect !== undefined && { vehicle: vehicleConnectDisconnect })
            };

            // 4. Update
            const updatedBudget = await prisma.budget.update({
                where: { id: budgetId },
                data: dataToUpdate,
                include: { vehicle: { select: { id: true, alias: true } } }
            });

            return c.json(updatedBudget);

        } catch (error) {
            next(error);
        }
    }
);

// --- DELETE /:budgetId (Delete Budget) ---
budgetRoutesController.delete(
    '/:budgetId',
    authorize([permissions.budget.delete]),
    zValidator('param', budgetIdParamSchema.shape.params),
    async (c) => {

        const { budgetId } = c.req.valid('param');

        try {
            const prisma = c.get('prisma');
            const user = c.get('user');
            await checkBudgetOwnership(prisma, user.id, budgetId); // Verify ownership
            await prisma.budget.delete({ where: { id: budgetId } });

            return c.body(null, 204); // No Content
        } catch (error) {
            next(error)
        }
    }
);

// --- GET /:budgetId/status (Calculate Budget Status) ---
budgetRoutesController.get(
    '/:budgetId/status',
    authorize([permissions.budget.read]), // Same read permission likely suffices
    zValidator('param', budgetIdParamSchema.shape.params),
    async (c) => {
        const { budgetId } = c.req.valid('param');

        try {
            const prisma = c.get('prisma');
            const user = c.get('user');
            const budget = await checkBudgetOwnership(prisma, user.id, budgetId);
            const { startDate, endDate, vehicleId, amount } = budget;

            const adjustedEndDate = new Date(endDate);
            adjustedEndDate.setHours(23, 59, 59, 999);

            // Define where clauses for expenses/fueling
            const expenseWhere: Prisma.GeneralExpenseWhereInput = {
                userId: user.id, // Only user's expenses affecting budget? Or anyone associated with the vehicle? Decide based on requirements. Assuming user's expenses.
                expenseDate: { gte: startDate, lte: adjustedEndDate },
                ...(vehicleId && { vehicleId: vehicleId })
            };
            const fuelingWhere: Prisma.FuelingWhereInput = {
                userId: user.id, // Same decision as above
                timestamp: { gte: startDate, lte: adjustedEndDate },
                ...(vehicleId && { vehicleId: vehicleId })
            };

            // Aggregate costs
            const [generalResult, fuelingResult] = await prisma.$transaction([
                prisma.generalExpense.aggregate({ _sum: { cost: true }, where: expenseWhere }),
                prisma.fueling.aggregate({ _sum: { cost: true }, where: fuelingWhere })
            ]);

            const totalGeneralSpent = generalResult._sum.cost ?? new Decimal(0);
            const totalFuelingSpent = fuelingResult._sum.cost ?? new Decimal(0);
            const totalSpent = totalGeneralSpent.plus(totalFuelingSpent);
            const remaining = amount.minus(totalSpent);
            const percentageSpent = amount.isZero() ? new Decimal(0) : totalSpent.dividedBy(amount).times(100);

            const budgetStatusResponse = {
                ...budget, // Include original budget details
                amount: amount.toFixed(2), // Format Decimals for response
                totalGeneralSpent: totalGeneralSpent.toFixed(2),
                totalFuelingSpent: totalFuelingSpent.toFixed(2),
                totalSpent: totalSpent.toFixed(2),
                remaining: remaining.toFixed(2),
                percentageSpent: percentageSpent.toDecimalPlaces(2).toFixed(2), // Ensure 2 decimal places
                isOverBudget: remaining.isNegative(),
            };

            return c.json(budgetStatusResponse);

        } catch (error) {
            next(error);
        }
    }
);


export default budgetRoutesController;