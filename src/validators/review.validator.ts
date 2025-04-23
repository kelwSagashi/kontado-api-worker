// src/validators/review.validator.ts (Novo Arquivo)
import { z } from 'zod';
import { ReviewVote, ReviewStatus } from '@prisma/client';

export const proposalIdParamSchema = (proposalType: 'gasStation' | 'stationPrice') => z.object({
    params: z.object({
        proposalId: z.string().uuid(`ID da proposta de ${proposalType} inválido.`),
    }),
});

export const submitReviewSchema = z.object({
    body: z.object({
        vote: z.nativeEnum(ReviewVote, { required_error: "Voto é obrigatório." }),
        comment: z.string().optional(),
    }),
});

export const listProposalsSchema = z.object({
    query: z.object({
        status: z.nativeEnum(ReviewStatus).default(ReviewStatus.PENDING).optional(),
        // Outros filtros? proposerId?
        page: z.coerce.number().int().positive().default(1).optional(),
        limit: z.coerce.number().int().positive().max(50).default(10).optional(),
        name: z.string().optional(),
    }).optional(),
});


// Tipos
export type SubmitReviewInput = z.infer<typeof submitReviewSchema>['body'];
export type ListProposalsQuery = z.infer<typeof listProposalsSchema>['query'];