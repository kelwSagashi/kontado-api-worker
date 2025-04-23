// src/validators/fuelType.validator.ts
import { z } from 'zod';

export const createFuelTypeSchema = z.object({
    body: z.object({
        name: z.string({ required_error: "Nome do tipo de combustível é obrigatório." })
                 .min(1, "Nome não pode ser vazio."),
    }),
});

export const updateFuelTypeSchema = z.object({
    params: z.object({
        fuelTypeId: z.string().uuid("ID do tipo de combustível inválido."),
    }),
    body: z.object({
        name: z.string({ required_error: "Nome é obrigatório para atualização." })
                 .min(1, "Nome não pode ser vazio."),
    }), // Para PATCH, poderia ser .optional() e com .refine para garantir que não está vazio
});

export const fuelTypeIdParamSchema = z.object({
    params: z.object({
        fuelTypeId: z.string().uuid("ID do tipo de combustível inválido."),
    }),
});

// Types
export type CreateFuelTypeInput = z.infer<typeof createFuelTypeSchema>['body'];
export type UpdateFuelTypeInput = z.infer<typeof updateFuelTypeSchema>['body'];
export type FuelTypeIdParams = z.infer<typeof fuelTypeIdParamSchema>['params'];