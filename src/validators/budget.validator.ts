// src/validators/budget.validator.ts
import { z } from 'zod';
import { Decimal } from '@prisma/client/runtime/library';

const budgetBaseSchema = {
    name: z.string({ required_error: "Nome do orçamento é obrigatório." }).min(1).max(100),
    amount: z.coerce.number({ required_error: "Valor do orçamento é obrigatório." })
                .positive({ message: "Valor do orçamento deve ser positivo." }),
    startDate: z.coerce.date({ required_error: "Data inicial é obrigatória." }),
    endDate: z.coerce.date({ required_error: "Data final é obrigatória." }),
    notes: z.string().max(500).optional(),
    vehicleId: z.string().uuid("ID do veículo inválido.").optional().nullable(), // Opcional e pode ser null
};

export const createBudgetSchema = z.object({
    body: z.object(budgetBaseSchema)
        .refine(data => data.endDate >= data.startDate, {
            message: "Data final deve ser maior ou igual à data inicial.",
            path: ["endDate"],
        }),
});

export const updateBudgetSchema = z.object({
    params: z.object({
        budgetId: z.string().uuid("ID do orçamento inválido."),
    }),
    body: z.object({ // Todos opcionais para PATCH
        name: budgetBaseSchema.name.optional(),
        amount: budgetBaseSchema.amount.optional(),
        startDate: budgetBaseSchema.startDate.optional(),
        endDate: budgetBaseSchema.endDate.optional(),
        notes: budgetBaseSchema.notes.optional().nullable(), // Permitir limpar notas
        vehicleId: budgetBaseSchema.vehicleId.optional(), // Permitir desvincular/vincular veículo
    })
    .refine(data => Object.keys(data).length > 0, {
        message: "Pelo menos um campo deve ser fornecido para atualização.",
    })
    // Refinamento para garantir que se as datas forem atualizadas, endDate >= startDate
    .refine(data => (data.startDate === undefined || data.endDate === undefined) || data.endDate >= data.startDate, {
         message: "Data final deve ser maior ou igual à data inicial.",
         path: ["endDate"],
     }),
});

export const budgetIdParamSchema = z.object({
    params: z.object({
        budgetId: z.string().uuid("ID do orçamento inválido."),
    }),
});

export const listBudgetsSchema = z.object({
    query: z.object({
        vehicleId: z.string().uuid().optional(), // Filtrar por veículo específico
        // Filtro para buscar orçamentos ativos em uma data específica (ex: hoje)
        activeOnDate: z.coerce.date().optional(),
        // Paginação?
        page: z.coerce.number().int().positive().default(1).optional(),
        limit: z.coerce.number().int().positive().max(50).default(10).optional(),
    }).optional(),
});


// Tipos
export type CreateBudgetInput = z.infer<typeof createBudgetSchema>['body'];
export type UpdateBudgetInput = z.infer<typeof updateBudgetSchema>['body'];
export type BudgetIdParams = z.infer<typeof budgetIdParamSchema>['params'];
export type ListBudgetsQuery = z.infer<typeof listBudgetsSchema>['query'];