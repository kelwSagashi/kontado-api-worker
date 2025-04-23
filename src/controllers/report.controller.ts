// src/controllers/report.controller.ts
import AppError from '../utils/AppError';
import { Prisma, PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';

// Import types from validator
import {
    userReportSchema,
    vehicleReportSchema,
} from '../validators/report.validator';
import { protect } from 'middlewares/auth.middleware';
import { Hono } from 'hono';
import { AppEnv } from 'hono';
import { PrismaD1 } from '@prisma/adapter-d1';
import { Context } from 'hono';
import { authorize } from 'middlewares/authorize.middleware';
import permissions from 'utils/permissions';
import { zValidator } from '@hono/zod-validator';
import vehicleRoutesController, { checkVehicleAccess } from './vehicle.controller';
import next from 'middlewares/next.middleware';

// Ajusta data final para incluir o dia inteiro
export function getEndOfDay(date: Date): Date {
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);
    return endOfDay;
}
// Ajusta data final para incluir o dia inteiro
export function getStartOfDay(date: Date): Date {
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    return startOfDay;
}

const getPrisma = (c: Context<AppEnv>) => {
    const adapter = new PrismaD1(c.env.DB);
    const prisma = new PrismaClient({ adapter });
    if (!prisma) throw new AppError('Internal server configuration error (Prisma).', 500);
    return prisma;
}

const reportRoutesController = new Hono<AppEnv>();

// Apply common middleware
reportRoutesController.use('*', protect, authorize([permissions.user.any])); // Protect all and ensure Prisma

// ==============================
// Report Routes
// ==============================

// GET /api/vehicles/:vehicleId/reports/summary - Get expense summary for a vehicle
vehicleRoutesController.get(
    '/:vehicleId/reports/summary',
    authorize([permissions.user.any]), // Reuse expense read permission
    zValidator('param', vehicleReportSchema.shape.params),
    zValidator('query', vehicleReportSchema.shape.query),
    async (c) => {
        const userId = c.get('user')!.id;
        const { vehicleId } = c.req.valid('param');
        const { startDate, endDate } = c.req.valid('query') ?? {}; // Use ?? {} for safety

        try {
            const prisma = getPrisma(c);
            // 1. Check vehicle access
            const hasAccess = await checkVehicleAccess(prisma, userId, vehicleId);
            if (!hasAccess) return next(new AppError('Acesso negado ou veículo não encontrado.', 403));

            // 2. Build date filters
            const dateFilterGeneral: Prisma.DateTimeFilter = {};
            const dateFilterFueling: Prisma.DateTimeFilter = {};
            if (startDate) {
                const startOfDay = getStartOfDay(startDate);
                dateFilterGeneral.gte = startOfDay;
                dateFilterFueling.gte = startOfDay;
            }
            if (endDate) {
                // Adjust endDate to include the whole day
                const endOfDay = getEndOfDay(endDate);
                dateFilterGeneral.lte = endOfDay;
                dateFilterFueling.lte = endOfDay;
            }

            // 3. Aggregate General Expenses
            const generalExpenseAggregation = prisma.generalExpense.aggregate({
                _sum: { cost: true },
                where: {
                    vehicleId: vehicleId,
                    ...(Object.keys(dateFilterGeneral).length > 0 && { expenseDate: dateFilterGeneral }),
                },
            });

            // 4. Aggregate Fueling Expenses
            const fuelingAggregation = prisma.fueling.aggregate({
                _sum: { cost: true },
                where: {
                    vehicleId: vehicleId,
                    ...(Object.keys(dateFilterFueling).length > 0 && { timestamp: dateFilterFueling }),
                },
            });

            // 5. Execute aggregations in parallel
            const [generalResult, fuelingResult] = await Promise.all([
                generalExpenseAggregation,
                fuelingAggregation
            ]);

            // 6. Format results
            const totalGeneralCost = generalResult._sum.cost ?? new Decimal(0);
            const totalFuelingCost = fuelingResult._sum.cost ?? new Decimal(0);
            const totalOverallCost = totalGeneralCost.plus(totalFuelingCost);

            const summary = {
                vehicleId: vehicleId,
                filterStartDate: startDate ? getStartOfDay(startDate).toISOString().split('T')[0] : null, // YYYY-MM-DD
                filterEndDate: endDate ? getEndOfDay(endDate).toISOString().split('T')[0] : null,     // YYYY-MM-DD
                totalGeneralCost: totalGeneralCost.toFixed(2), // Format as string with 2 decimal places
                totalFuelingCost: totalFuelingCost.toFixed(2),
                totalOverallCost: totalOverallCost.toFixed(2),
            };

            return c.json(summary);

        } catch (error) {
            next(error);
        }
    }
);

// GET /api/vehicles/:vehicleId/reports/expenses-by-category - Get general expenses grouped by category
vehicleRoutesController.get(
    '/:vehicleId/reports/expenses-by-category',
    authorize([permissions.user.any]),
    zValidator('param', vehicleReportSchema.shape.params),
    zValidator('query', vehicleReportSchema.shape.query),
    async (c) => {
        const userId = c.get('user')!.id;
        const { vehicleId } = c.req.valid('param');
        const { startDate, endDate } = c.req.valid('query') ?? {};

        try {
            const prisma = getPrisma(c);
            // 1. Check vehicle access
            const hasAccess = await checkVehicleAccess(prisma, userId, vehicleId);
            if (!hasAccess) return next(new AppError('Acesso negado ou veículo não encontrado.', 403));

            // 2. Build date filter
            const dateFilter: Prisma.DateTimeFilter = {};
            if (startDate) {
                dateFilter.gte = getStartOfDay(startDate);
            }
            if (endDate) {
                dateFilter.lte = getEndOfDay(endDate);
            }

            // 3. Group General Expenses by Category
            const groupedExpenses = await prisma.generalExpense.groupBy({
                by: ['categoryId'], // Group by the foreign key
                _sum: { cost: true },
                where: {
                    vehicleId: vehicleId,
                    ...(Object.keys(dateFilter).length > 0 && { expenseDate: dateFilter }),
                },
            });

            // If no expenses found, return empty array
            if (groupedExpenses.length === 0) {
                return c.json([]);
            }

            // 4. Get Category details for the groups found
            const categoryIds = groupedExpenses.map(g => g.categoryId);
            const categories = await prisma.expenseCategory.findMany({
                where: {
                    id: { in: categoryIds }
                },
                select: { id: true, name: true, iconName: true }
            });

            // Create a map for quick lookup
            const categoryMap = new Map(categories.map(c => [c.id, c]));

            // 5. Combine group results with category details
            const results = groupedExpenses.map(group => {
                const categoryInfo = categoryMap.get(group.categoryId);
                return {
                    categoryId: group.categoryId,
                    categoryName: categoryInfo?.name ?? 'Categoria Desconhecida', // Handle missing category?
                    categoryIcon: categoryInfo?.iconName ?? 'help',
                    totalCost: (group._sum.cost ?? new Decimal(0)).toFixed(2),
                };
            }).sort((a, b) => b.totalCost.localeCompare(a.totalCost)); // Sort by cost descending

            return c.json(results);

        } catch (error) {
            next(error);
        }
    }
);

// --- NOVO: Sumário de Abastecimento do Veículo ---
// GET /api/vehicles/:vehicleId/reports/fueling-summary - Sumário de abastecimento
vehicleRoutesController.get(
    '/:vehicleId/reports/fueling-summary',
    authorize([permissions.user.any]), // Ou expense:read:own
    zValidator('param', vehicleReportSchema.shape.params),
    zValidator('query', vehicleReportSchema.shape.query),
    async (c) => {
        const userId = c.get('user')!.id;
        const { vehicleId } = c.req.valid('param');
        const { startDate, endDate } = c.req.valid('query') ?? {};

        try {
            const prisma = getPrisma(c);
            const hasAccess = await checkVehicleAccess(prisma, userId, vehicleId);
            if (!hasAccess) return next(new AppError('Acesso negado ou veículo não encontrado.', 403));

            const dateFilter: Prisma.DateTimeFilter = {};
            if (startDate) dateFilter.gte = getStartOfDay(startDate);
            if (endDate) dateFilter.lte = getEndOfDay(endDate);

            const fuelingAggregation = await prisma.fueling.aggregate({
                _sum: {
                    cost: true,
                    pricePerLiter: true
                },
                _avg: {
                    pricePerLiter: true, // Média simples do preço por litro registrado
                },
                _count: {
                    id: true, // Contagem de registros de abastecimento
                },
                where: {
                    vehicleId: vehicleId,
                    ...(Object.keys(dateFilter).length > 0 && { timestamp: dateFilter }),
                },
            });

            // Calcular média de preço por litro manualmente se avg não for bom (ex: se muitos volumes forem nulos)
            // const manualAvgPrice = fuelingAggregation._sum.cost && fuelingAggregation._sum.volume && fuelingAggregation._sum.volume.greaterThan(0)
            //     ? fuelingAggregation._sum.cost.dividedBy(fuelingAggregation._sum.volume)
            //     : null;

            const summary = {
                vehicleId: vehicleId,
                filterStartDate: startDate?.toISOString().split('T')[0] || null,
                filterEndDate: endDate?.toISOString().split('T')[0] || null,
                totalFuelingCost: (fuelingAggregation._sum.cost ?? new Decimal(0)).toFixed(2),
                averagePricePerLiter: fuelingAggregation._avg.pricePerLiter?.toFixed(3) ?? null, // Média com 3 casas
                // averagePricePerLiter: manualAvgPrice?.toFixed(3) ?? null, // Alternativa
                fuelingCount: fuelingAggregation._count.id ?? 0,
                // averageConsumption: null // TODO: Calcular futuramente
                volume: null
            };

            return c.json(summary);

        } catch (error) {
            next(error);
        }
    }
);


// --- Controllers de Relatório Geral do Usuário (Novos) ---
// GET /api/reports/overall-summary - Sumário geral de gastos do usuário (todos veículos ou um específico)
reportRoutesController.get(
    '/overall-summary',
    zValidator('query', userReportSchema.shape.query), // Valida query params (vehicleId opcional, datas)
    async (c) => {
        const userId = c.get('user').id;
        const { vehicleId, startDate, endDate } = c.req.valid('query') ?? {}; // vehicleId é opcional aqui

        try {
            const prisma = getPrisma(c);
            // Se um vehicleId foi fornecido, verifica o acesso a ele
            if (vehicleId) {
                const hasAccess = await checkVehicleAccess(prisma, userId, vehicleId);
                if (!hasAccess) return next(new AppError(`Acesso negado ou veículo ${vehicleId} não encontrado.`, 403));
            }

            // Filtros de data e veículo (se aplicável)
            const dateFilterGeneral: Prisma.DateTimeFilter = {};
            const dateFilterFueling: Prisma.DateTimeFilter = {};
            if (startDate) { /* ... set gte ... */
                const startOfDay = getStartOfDay(startDate);
                dateFilterGeneral.gte = startOfDay;
                dateFilterFueling.gte = startOfDay;
            }
            if (endDate) { /* ... set lte endOfDay ... */
                const endOfDay = getEndOfDay(endDate);
                dateFilterGeneral.lte = endOfDay;
                dateFilterFueling.lte = endOfDay;
            }

            const generalWhere: Prisma.GeneralExpenseWhereInput = {
                userId: userId, // Filtra pelo usuário
                ...(vehicleId && { vehicleId: vehicleId }), // Filtra por veículo se fornecido
                ...(Object.keys(dateFilterGeneral).length > 0 && { expenseDate: dateFilterGeneral }),
            };
            const fuelingWhere: Prisma.FuelingWhereInput = {
                userId: userId, // Filtra pelo usuário
                ...(vehicleId && { vehicleId: vehicleId }), // Filtra por veículo se fornecido
                ...(Object.keys(dateFilterFueling).length > 0 && { timestamp: dateFilterFueling }),
            };

            // Agregações
            const [generalResult, fuelingResult] = await Promise.all([
                prisma.generalExpense.aggregate({ _sum: { cost: true }, where: generalWhere }),
                prisma.fueling.aggregate({ _sum: { cost: true }, where: fuelingWhere })
            ]);

            // Formatação
            const totalGeneralCost = generalResult._sum.cost ?? new Decimal(0);
            const totalFuelingCost = fuelingResult._sum.cost ?? new Decimal(0);
            const totalOverallCost = totalGeneralCost.plus(totalFuelingCost);

            const summary = {
                userId: userId, // Identifica o usuário do relatório
                vehicleId: vehicleId ?? null, // Indica se foi filtrado por veículo
                filterStartDate: startDate?.toISOString().split('T')[0] || null,
                filterEndDate: endDate?.toISOString().split('T')[0] || null,
                totalGeneralCost: totalGeneralCost.toFixed(2),
                totalFuelingCost: totalFuelingCost.toFixed(2),
                totalOverallCost: totalOverallCost.toFixed(2),
            };

            return c.json(summary);

        } catch (error) {
            next(error);
        }
    }
);

// GET /api/reports/expenses-by-category - Gastos gerais do usuário por categoria
reportRoutesController.get(
    '/expenses-by-category',
    zValidator('query', userReportSchema.shape.query), // Valida query params
    async (c) => {
        const userId = c.get('user').id;
        const { vehicleId, startDate, endDate } = c.req.valid('query') ?? {};

        try {
            const prisma = getPrisma(c);
            if (vehicleId) {
                const hasAccess = await checkVehicleAccess(prisma, userId, vehicleId);
                if (!hasAccess) return next(new AppError(`Acesso negado ou veículo ${vehicleId} não encontrado.`, 403));
            }

            const dateFilter: Prisma.DateTimeFilter = {};
            if (startDate) dateFilter.gte = getStartOfDay(startDate);
            if (endDate) dateFilter.lte = getEndOfDay(endDate);

            const where: Prisma.GeneralExpenseWhereInput = {
                userId: userId, // Filtra pelo usuário
                ...(vehicleId && { vehicleId: vehicleId }), // Filtra por veículo se fornecido
                ...(Object.keys(dateFilter).length > 0 && { expenseDate: dateFilter }),
            };

            // Agrupa gastos GERAIS por categoria
            const groupedExpenses = await prisma.generalExpense.groupBy({
                by: ['categoryId'],
                _sum: { cost: true },
                where: where,
            });

            if (groupedExpenses.length === 0) {
                return c.json([]);
            }

            // Busca detalhes das categorias encontradas
            const categoryIds = groupedExpenses.map(g => g.categoryId);
            const categories = await prisma.expenseCategory.findMany({
                where: { id: { in: categoryIds } },
                select: { id: true, name: true, iconName: true }
            });
            const categoryMap = new Map(categories.map(c => [c.id, c]));

            // Combina e formata
            const results = groupedExpenses.map(group => {
                const categoryInfo = categoryMap.get(group.categoryId);
                return {
                    categoryId: group.categoryId,
                    categoryName: categoryInfo?.name ?? 'Desconhecida',
                    categoryIcon: categoryInfo?.iconName ?? 'help',
                    totalCost: (group._sum.cost ?? new Decimal(0)).toFixed(2),
                };
            }).sort((a, b) => parseFloat(b.totalCost) - parseFloat(a.totalCost)); // Ordena

            return c.json(results);

        } catch (error) {
            next(error);
        }
    }
);

// --- NOVO: Tendência Mensal ---
// GET /api/reports/monthly-trend - Tendência de gastos mensais do usuário
reportRoutesController.get(
    '/monthly-trend',
    zValidator('query', userReportSchema.shape.query),
    async (c) => {
        const userId = c.get('user')!.id;
        const { vehicleId, year } = c.req.valid('query') ?? {}; // Foco no filtro por ano

        try {
            const prisma = getPrisma(c);
            if (vehicleId) {
                const hasAccess = await checkVehicleAccess(prisma, userId, vehicleId);
                if (!hasAccess) return next(new AppError(`Acesso negado ou veículo ${vehicleId} não encontrado.`, 403));
            }

            // Define o ano alvo (padrão: ano atual se não fornecido)
            const targetYear = year ?? new Date().getFullYear();
            const yearStart = new Date(targetYear, 0, 1); // Jan 1st
            const yearEnd = new Date(targetYear, 11, 31, 23, 59, 59, 999); // Dec 31st end of day

            // Filtros base
            const generalWhere: Prisma.GeneralExpenseWhereInput = {
                userId: userId,
                expenseDate: { gte: yearStart, lte: yearEnd },
                ...(vehicleId && { vehicleId: vehicleId }),
            };
            const fuelingWhere: Prisma.FuelingWhereInput = {
                userId: userId,
                timestamp: { gte: yearStart, lte: yearEnd },
                ...(vehicleId && { vehicleId: vehicleId }),
            };


            // --- Usando Raw Query para agrupar por mês (mais eficiente) ---
            // Nota: Sintaxe $queryRawUnsafe é usada aqui para interpolação dinâmica de data,
            // o que requer cuidado extra com sanitização, mas as datas são validadas pelo Zod.
            // Alternativamente, poderia fazer 2 queries separadas com groupBy e juntar no JS.
            const monthlyTotalsRaw = await prisma.$queryRaw<Array<{ month: string; type: 'general' | 'fueling'; total: number }>>`
            SELECT
                to_char(date_trunc('month', "expenseDate"), 'YYYY-MM') as month,
                'general' as type,
                SUM(cost)::float as total -- Cast para float para facilitar no JS
            FROM "general_expenses"
            WHERE "userId" = ${userId}
              AND "expenseDate" >= ${yearStart} AND "expenseDate" <= ${yearEnd}
              ${vehicleId ? Prisma.sql`AND "vehicleId" = ${vehicleId}` : Prisma.empty}
            GROUP BY month
            UNION ALL
            SELECT
                to_char(date_trunc('month', "timestamp"), 'YYYY-MM') as month,
                'fueling' as type,
                SUM(cost)::float as total
            FROM "fuelings"
             WHERE "userId" = ${userId}
              AND "timestamp" >= ${yearStart} AND "timestamp" <= ${yearEnd}
              ${vehicleId ? Prisma.sql`AND "vehicleId" = ${vehicleId}` : Prisma.empty}
            GROUP BY month
            ORDER BY month ASC;
        `;


            // --- Processa os resultados da query raw para agregar por mês ---
            const monthlyTrendMap = new Map<string, { month: string; totalGeneralCost: Decimal; totalFuelingCost: Decimal }>();

            // Inicializa o mapa para todos os meses do ano alvo
            for (let m = 0; m < 12; m++) {
                const monthDate = new Date(targetYear, m, 1);
                const monthStr = monthDate.toISOString().substring(0, 7); // Formato YYYY-MM
                monthlyTrendMap.set(monthStr, {
                    month: monthStr,
                    totalGeneralCost: new Decimal(0),
                    totalFuelingCost: new Decimal(0),
                });
            }

            // Preenche com os dados da query
            monthlyTotalsRaw.forEach(row => {
                const monthData = monthlyTrendMap.get(row.month);
                if (monthData) {
                    if (row.type === 'general') {
                        monthData.totalGeneralCost = monthData.totalGeneralCost.plus(row.total);
                    } else if (row.type === 'fueling') {
                        monthData.totalFuelingCost = monthData.totalFuelingCost.plus(row.total);
                    }
                }
            });

            // Converte o mapa para array e calcula o total mensal
            const results = Array.from(monthlyTrendMap.values()).map(data => ({
                month: data.month,
                totalGeneralCost: data.totalGeneralCost.toFixed(2),
                totalFuelingCost: data.totalFuelingCost.toFixed(2),
                totalOverallCost: data.totalGeneralCost.plus(data.totalFuelingCost).toFixed(2),
            }));

            return c.json(results);

        } catch (error) {
            next(error);
        }
    }
);

export default reportRoutesController;