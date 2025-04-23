// src/validators/vehicle.validator.ts
import { z } from 'zod';

const commonVehicleFields = {
    alias: z.string({ required_error: 'Apelido é obrigatório.' })
        .min(1, { message: 'Apelido não pode ser vazio.' }),
    brand: z.string({ required_error: 'Marca é obrigatória.' })
        .min(1, { message: 'Marca não pode ser vazia.' }),
    model: z.string({ required_error: 'Modelo é obrigatório.' })
        .min(1, { message: 'Modelo não pode ser vazio.' }),
    plate: z.string()
        .regex(/^[A-Z]{3}-?\d{1}[A-Z0-9]{1}\d{2}$/i, { message: "Formato de placa inválido (Ex: ABC-1D34 ou ABC1D34)" }) // Aceita Mercosul e antiga
        .or(z.literal('')) // Permite string vazia ou o regex
        .transform(v => v ? v.toUpperCase().replace('-', '') : ''),
    kmlCity: z.coerce.number(),
    kmlRoad: z.coerce.number(),
    yearManufacture: z.coerce.number({ required_error: 'Ano de fabricação é obrigatório.', invalid_type_error: 'Ano de fabricação deve ser um número.' })
        .int({ message: 'Ano de fabricação deve ser um número inteiro.' })
        .min(1900, { message: 'Ano de fabricação parece inválido.' })
        .max(new Date().getFullYear() + 1, { message: 'Ano de fabricação não pode ser futuro.' }), // Allow next year
    yearModel: z.coerce.number({ required_error: 'Ano do modelo é obrigatório.', invalid_type_error: 'Ano do modelo deve ser um número.' })
        .int({ message: 'Ano do modelo deve ser um número inteiro.' })
        .min(1900, { message: 'Ano do modelo parece inválido.' })
        .max(new Date().getFullYear() + 2, { message: 'Ano do modelo inválido.' }),
    color: z.string({ required_error: 'Cor é obrigatória.' })
        .min(1, { message: 'Cor não pode ser vazia.' }),
    categoryId: z.string({ required_error: 'ID da categoria é obrigatório.' })
        .uuid({ message: 'ID da categoria inválido (deve ser UUID).' }),
    appOdometer: z.coerce.number({ invalid_type_error: 'Hodômetro deve ser um número.' })
        .nonnegative({ message: 'Hodômetro não pode ser negativo.' })
        .optional(),
};

// Schema for Creating a Vehicle
export const createVehicleSchema = z.object({
    body: z.object(commonVehicleFields),
});

// Schema for Path Parameter (vehicleId)
const paramsSchema = z.object({
    vehicleId: z.string().uuid({ message: "ID do veículo inválido (deve ser UUID)." }),
});

// Schema for Updating a Vehicle
export const updateVehicleSchema = z.object({
    params: paramsSchema,
    body: z.object({ // Make all fields optional for PATCH
        alias: commonVehicleFields.alias.optional(),
        brand: commonVehicleFields.brand.optional(),
        model: commonVehicleFields.model.optional(),
        plate: commonVehicleFields.plate.optional(),
        kmlCity: commonVehicleFields.kmlCity.optional(),
        kmlRoad: commonVehicleFields.kmlRoad.optional(),
        yearManufacture: commonVehicleFields.yearManufacture.optional(),
        yearModel: commonVehicleFields.yearModel.optional(),
        color: commonVehicleFields.color.optional(),
        categoryId: commonVehicleFields.categoryId.optional(),
        appOdometer: commonVehicleFields.appOdometer.optional(),
    }).refine(data => Object.keys(data).length > 0, { // Ensure at least one field is provided
        message: "Pelo menos um campo deve ser fornecido para atualização.",
    }),
});

// Schema for Getting/Deleting a specific vehicle (only needs params)
export const vehicleIdSchema = z.object({
    params: paramsSchema,
});

// Schema for Granting Authorization
export const grantAuthorizationSchema = z.object({
    params: paramsSchema, // vehicleId
    body: z.object({
        userId: z.string({ required_error: 'ID do usuário a ser autorizado é obrigatório.' })
            .uuid({ message: 'ID do usuário inválido (deve ser UUID).' }),
    }),
});

// Schema for Revoking Authorization
export const revokeAuthorizationSchema = z.object({
    params: z.object({
        vehicleId: z.string().uuid({ message: "ID do veículo inválido." }),
        userId: z.string().uuid({ message: "ID do usuário a ter autorização revogada inválido." }),
    }),
});


// Types for Controller usage
export type CreateVehicleInput = z.infer<typeof createVehicleSchema>['body'];
export type UpdateVehicleInput = z.infer<typeof updateVehicleSchema>['body'];
export type VehicleIdParams = z.infer<typeof vehicleIdSchema>['params'];
export type GrantAuthorizationInput = z.infer<typeof grantAuthorizationSchema>['body'];
export type GrantAuthorizationParams = z.infer<typeof grantAuthorizationSchema>['params'];
export type RevokeAuthorizationParams = z.infer<typeof revokeAuthorizationSchema>['params'];