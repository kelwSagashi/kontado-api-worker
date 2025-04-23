// src/validators/vehicleCategory.validator.ts
import { z } from 'zod';

const baseSchema = {
    name: z.string({ required_error: "Nome da categoria é obrigatório." }).min(1, "Nome não pode ser vazio."),
    iconName: z.string({ required_error: "Nome do ícone é obrigatório." }).min(1, "Nome do ícone não pode ser vazio."),
};

export const createVehicleCategorySchema = z.object({
    body: z.object(baseSchema),
});

export const updateVehicleCategorySchema = z.object({
    params: z.object({
        categoryId: z.string().uuid("ID da categoria inválido."),
    }),
    body: z.object({ // Optional fields for PATCH
        name: baseSchema.name.optional(),
        iconName: baseSchema.iconName.optional(),
    }).refine(data => Object.keys(data).length > 0, {
        message: "Pelo menos um campo (name ou iconName) deve ser fornecido.",
    }),
});

export const categoryIdParamSchema = z.object({
    params: z.object({
        categoryId: z.string().uuid("ID da categoria inválido."),
    }),
});

// Types
export type CreateVehicleCategoryInput = z.infer<typeof createVehicleCategorySchema>['body'];
export type UpdateVehicleCategoryInput = z.infer<typeof updateVehicleCategorySchema>['body'];
export type CategoryIdParams = z.infer<typeof categoryIdParamSchema>['params'];