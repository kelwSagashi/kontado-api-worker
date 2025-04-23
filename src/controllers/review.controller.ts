// src/controllers/review.controller.ts (Novo)

import AppError from '../utils/AppError';
import { Prisma, PrismaClient, ReviewStatus } from '@prisma/client'; // Import enums

import { SubmitReviewInput, ListProposalsQuery, proposalIdParamSchema, submitReviewSchema, listProposalsSchema } from '../validators/review.validator';
import { protect } from 'middlewares/auth.middleware';
import { authorize } from 'middlewares/authorize.middleware';
import permissions from 'utils/permissions';
import { Context, Hono } from 'hono';
import { AppEnv } from 'hono';
import { PrismaD1 } from '@prisma/adapter-d1';
import { zValidator } from '@hono/zod-validator';
import next from 'middlewares/next.middleware';

// Helper to get proposal and check status (DRY principle)
async function findProposal<T extends { status: ReviewStatus }>(
    prisma: PrismaClient,
    proposalId: string,
    model: 'gasStationProposal' | 'stationPriceProposal'
): Promise<T> {
    const proposal = await (prisma[model] as any).findUnique({
        where: { id: proposalId },
    });
    if (!proposal) {
        throw new AppError(`Proposta não encontrada.`, 404);
    }
    if (proposal.status !== ReviewStatus.PENDING) {
        throw new AppError(`Esta proposta não está mais pendente (status: ${proposal.status}).`, 409);
    }
    return proposal as T;
}

const getPrisma = (c: Context<AppEnv>) => {
    const adapter = new PrismaD1(c.env.DB);
    const prisma = new PrismaClient({ adapter });
    if (!prisma) throw new AppError('Internal server configuration error (Prisma).', 500);
    return prisma;
}

const reviewRoutesController = new Hono<AppEnv>();

// Apply common middleware
reviewRoutesController.use('*', protect, authorize([permissions.user.any])); // Protect all and ensure Prisma

// ==============================
// Review Routes
// ==============================

// --- Submissão de Votos ---
reviewRoutesController.post(
    '/gas-station/:proposalId/vote',
    zValidator('param', proposalIdParamSchema('gasStation').shape.params), // Valida ID da proposta
    zValidator('json', submitReviewSchema.shape.body), // Valida corpo do voto
    async (c) => {
        const reviewerId = c.get('user')!.id;
        const { proposalId } = c.req.valid('param');
        const { vote, comment } = c.req.valid('json');

        try {

            const prisma = getPrisma(c);
            // 1. Find proposal and check status
            const proposal = await findProposal<{
                id: string,
                status: ReviewStatus,
                proposerId: string
            }>(
                prisma,
                proposalId,
                'gasStationProposal'
            );

            // 2. Prevent self-review? (Optional)
            // if (proposal.proposerId === reviewerId) return next(new AppError('Auto-revisão não permitida.', 403));

            // 3. Record the vote (Upsert handles duplicates)
            const review = await prisma.gasStationReview.upsert({
                where: { gasStationProposalId_reviewerId: { gasStationProposalId: proposalId, reviewerId: reviewerId } },
                update: { vote: vote, comment: comment ?? null },
                create: { gasStationProposalId: proposalId, reviewerId: reviewerId, vote: vote, comment: comment ?? null },
                select: { vote: true, createdAt: true, updatedAt: true }
            });

            // --- TODO: Implement Vote Processing Logic ---
            // This is where the complex part goes. After a vote, check:
            // - Quorum reached? (e.g., >= 5 votes)
            // - Consensus reached? (e.g., > 60% ACCEPT, 0 PROTEST)
            // - If YES:
            //    - Update GasStationProposal status to VERIFIED/REJECTED
            //    - Update GasStation status to ACTIVE/REJECTED/INACTIVE
            //    - Add resolutionNotes
            // - If PROTEST:
            //    - Update GasStationProposal status to PROTESTED
            // This logic should likely live in a separate service/job, not directly here.
            console.log(`GasStation review recorded for proposal ${proposalId}. Needs processing.`);
            // --- End TODO ---

            return c.json({ message: "Voto registrado.", review });

        } catch (error) {
            next(error);
        }
    }
);

reviewRoutesController.post(
    '/station-price/:proposalId/vote',
    zValidator('param', proposalIdParamSchema('stationPrice').shape.params),
    zValidator('json', submitReviewSchema.shape.body),
    async (c) => {
        const reviewerId = c.get('user')!.id;
        const { proposalId } = c.req.valid('param');
        const { vote, comment } = c.req.valid('json');

        try {
            const prisma = getPrisma(c);
            const proposal = await findProposal<{
                id: string,
                status: ReviewStatus,
                proposerId: string,
                stationPriceId: string
            }>(
                prisma,
                proposalId,
                'stationPriceProposal'
            );

            const review = await prisma.stationPriceReview.upsert({
                where: { stationPriceProposalId_reviewerId: { stationPriceProposalId: proposalId, reviewerId: reviewerId } },
                update: { vote: vote, comment: comment ?? null },
                create: { stationPriceProposalId: proposalId, reviewerId: reviewerId, vote: vote, comment: comment ?? null },
                select: { vote: true, createdAt: true, updatedAt: true }
            });

            // --- TODO: Implement Vote Processing Logic for Prices ---
            // Similar to station reviews, but updates StationPriceProposal status
            // and StationPrice status (ACTIVE, REJECTED, maybe OUTDATED later).
            console.log(`StationPrice review recorded for proposal ${proposalId}. Needs processing.`);
            // --- End TODO ---

            return c.json({ message: "Voto registrado.", review });

        } catch (error) {
            next(error);
        }
    }
);


// Função genérica para listar propostas (poderia ser refatorada ainda mais)
async function listProposals<T>(
    c: any,
    prisma: PrismaClient,
    modelName: 'gasStationProposal' | 'stationPriceProposal',
    includeRelations: any // Prisma include object
): Promise<void> {
    const { status = ReviewStatus.PENDING, page = 1, limit = 10 } = c.req.valid('query') ?? {};
    try {
        const skip = (page - 1) * limit;
        const where: Prisma.GasStationProposalWhereInput | Prisma.StationPriceProposalWhereInput = { status: status }; // Filtra por status

        const [proposals, totalCount] = await prisma.$transaction([
            (prisma[modelName] as any).findMany({
                where: where,
                orderBy: { createdAt: 'asc' }, // Ou 'desc' ?
                skip: skip,
                take: limit,
                include: includeRelations // Inclui relações passadas como argumento
            }),
            (prisma[modelName] as any).count({ where: where })
        ]);

        return c.json({
            data: proposals,
            meta: { currentPage: page, pageSize: limit, totalItems: totalCount, totalPages: Math.ceil(totalCount / limit) }
        });
    } catch (error) { next(error); }
}

// Listar Propostas Pendentes de Postos
reviewRoutesController.get(
    '/gas-station', // Lista propostas de postos (default: PENDING)
    zValidator('query', listProposalsSchema.shape.query), // Valida query params (status, paginação)
    async (c) => {
        const { status = ReviewStatus.PENDING, page = 1, limit = 10 } = c.req.valid('query') ?? {};

        try {
            const prisma = getPrisma(c);
            const skip = (page - 1) * limit;
            const where: Prisma.GasStationProposalWhereInput = { status: status }; // Filtra por status

            const [proposals, totalCount] = await prisma.$transaction([
                prisma.gasStationProposal.findMany({
                    where: where,
                    orderBy: { createdAt: 'asc' }, // Ou 'desc' ?
                    skip: skip,
                    take: limit,
                    include: {
                        gasStation: {
                            select: {
                                id: true,
                                name: true,
                                city: true,
                                state: true,
                                street: true,
                                neighborhood: true,
                                prices: {
                                    select: {
                                        price: true,
                                        fuelType: true
                                    },
                                }
                            },
                        }, // Contexto mínimo
                        proposer: { select: { id: true, username: true } },
                        _count: { select: { reviews: true } }
                    } // Inclui relações passadas como argumento
                }),
                prisma.gasStationProposal.count({ where: where })
            ]);

            return c.json({
                data: proposals,
                meta: { currentPage: page, pageSize: limit, totalItems: totalCount, totalPages: Math.ceil(totalCount / limit) }
            });
        } catch (error) { next(error); }
    }
);

// Listar Propostas Pendentes de Preços
reviewRoutesController.get(
    '/station-price', // Lista propostas de preços (default: PENDING)
    zValidator('query', listProposalsSchema.shape.query),
    async (c) => {
        const includeRelations = {
            stationPrice: {
                select: {
                    id: true, price: true, reportedAt: true,
                    fuelType: { select: { name: true } },
                    gasStation: { select: { id: true, name: true } }
                }
            },
            proposer: { select: { id: true, username: true } },

            _count: { select: { reviews: true } }
        };

        const { status = ReviewStatus.PENDING, page = 1, limit = 10 } = c.req.valid('query') ?? {};
        try {
            const prisma = getPrisma(c);
            const skip = (page - 1) * limit;
            const where: Prisma.StationPriceProposalWhereInput = { status: status }; // Filtra por status

            const [proposals, totalCount] = await prisma.$transaction([
                prisma.stationPriceProposal.findMany({
                    where: where,
                    orderBy: { createdAt: 'asc' }, // Ou 'desc' ?
                    skip: skip,
                    take: limit,
                    include: includeRelations // Inclui relações passadas como argumento
                }),
                prisma.stationPriceProposal.count({ where: where })
            ]);

            return c.json({
                data: proposals,
                meta: { currentPage: page, pageSize: limit, totalItems: totalCount, totalPages: Math.ceil(totalCount / limit) }
            });
        } catch (error) { next(error); }

        // await listProposals(c, res, next, 'stationPriceProposal', includeRelations);
    });


// --- Leitura de Propostas ---
reviewRoutesController.get(
    '/gas-station/pending',
    zValidator('query', listProposalsSchema.shape.query), // Valida query params (status, paginação)
    async (c) => {
        const { status = ReviewStatus.PENDING, page = 1, limit = 10 } = c.req.valid('query') ?? {};
        try {
            const prisma = getPrisma(c);
            const skip = (page - 1) * limit;
            const [proposals, totalCount] = await prisma.$transaction([
                prisma.gasStationProposal.findMany({
                    where: { status: status },
                    orderBy: { createdAt: 'asc' },
                    skip: skip,
                    take: limit,
                    include: {
                        gasStation: { select: { id: true, name: true } }, // Contexto
                        proposer: { select: { id: true, username: true } },
                        _count: { select: { reviews: true } } // Contagem de votos
                    }
                }),
                prisma.gasStationProposal.count({ where: { status: status } })
            ]);
            return c.json({
                data: proposals,
                meta: { currentPage: page, pageSize: limit, totalItems: totalCount, totalPages: Math.ceil(totalCount / limit) }
            });
        } catch (error) { next(error); }
    }
);


reviewRoutesController.get(
    '/station-price/pending',
    zValidator('query', listProposalsSchema.shape.query),
    async (c) => {
        const { status = ReviewStatus.PENDING, page = 1, limit = 10 } = c.req.valid('query') ?? {};
        try {
            const prisma = getPrisma(c);
            const skip = (page - 1) * limit;
            const [proposals, totalCount] = await prisma.$transaction([
                prisma.stationPriceProposal.findMany({
                    where: { status: status },
                    orderBy: { createdAt: 'asc' },
                    skip: skip,
                    take: limit,
                    include: {
                        stationPrice: { // Contexto do preço
                            select: { id: true, price: true, fuelType: { select: { name: true } }, gasStation: { select: { id: true, name: true } } }
                        },
                        proposer: { select: { id: true, username: true } },
                        _count: { select: { reviews: true } }
                    }
                }),
                prisma.stationPriceProposal.count({ where: { status: status } })
            ]);
            return c.json({
                data: proposals,
                meta: { currentPage: page, pageSize: limit, totalItems: totalCount, totalPages: Math.ceil(totalCount / limit) }
            });
        } catch (error) { next(error); }
    }
);

// getGasStationProposalDetails e getStationPriceProposalDetails
// Devem buscar a proposta específica pelo ID e incluir os reviews com detalhes do reviewer
// Exemplo:
reviewRoutesController.get(
    '/gas-station/:proposalId',
    zValidator('param', proposalIdParamSchema('gasStation').shape.params),
    async (c) => {
        const { proposalId } = c.req.valid('param');
        try {
            const prisma = getPrisma(c);
            const proposal = await prisma.gasStationProposal.findUnique({
                where: { id: proposalId },
                include: {
                    gasStation: true, // Detalhes completos do posto
                    proposer: { select: { id: true, username: true } },
                    reviews: { // Inclui os votos
                        orderBy: { createdAt: 'desc' },
                        include: { reviewer: { select: { id: true, username: true } } }
                    }
                }
            });
            if (!proposal) return next(new AppError('Proposta não encontrada.', 404));
            return c.json(proposal);
        } catch (error) { next(error); }
    }
);
// Implementar getStationPriceProposalDetails de forma similar...

export default reviewRoutesController;