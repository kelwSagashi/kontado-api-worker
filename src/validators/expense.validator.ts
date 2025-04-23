// src/validators/expense.validator.ts
import { z } from 'zod';
import { Decimal } from '@prisma/client/runtime/library'; // Import Decimal

// Common Param Schemas
export const vehicleIdParamSchema = z.object({
    params: z.object({
        vehicleId: z.string().uuid("ID do veículo inválido."),
    }),
});

export const generalExpenseIdParamSchema = z.object({
    params: z.object({
        expenseId: z.string().uuid("ID do gasto geral inválido."),
    }),
});

export const fuelingIdParamSchema = z.object({
    params: z.object({
        fuelingId: z.string().uuid("ID do abastecimento inválido."),
    }),
});


// --- General Expense Schemas ---

const generalExpenseBaseSchema = {
    description: z.string({ required_error: "Descrição é obrigatória." }).min(1),
    // Use coerce for flexibility (accepts string number) and refine later for Decimal
    cost: z.coerce.number({ required_error: "Custo é obrigatório.", invalid_type_error: "Custo deve ser um número." })
        .positive({ message: "Custo deve ser positivo." }),
    expenseDate: z.coerce.date({ required_error: "Data do gasto é obrigatória.", invalid_type_error: "Data inválida." }),
    notes: z.string().optional(),
    categoryId: z.string({ required_error: "ID da categoria de gasto é obrigatório." }).uuid(),
};

export const createGeneralExpenseSchema = z.object({
    params: vehicleIdParamSchema.shape.params,
    body: z.object(generalExpenseBaseSchema),
});

export const updateGeneralExpenseSchema = z.object({
    params: generalExpenseIdParamSchema.shape.params,
    body: z.object({ // All fields optional for PATCH
        description: generalExpenseBaseSchema.description.optional(),
        cost: generalExpenseBaseSchema.cost.optional(),
        expenseDate: generalExpenseBaseSchema.expenseDate.optional(),
        notes: generalExpenseBaseSchema.notes.optional().nullable(), // Allow explicit null to clear notes
        categoryId: generalExpenseBaseSchema.categoryId.optional(),
    }).refine(data => Object.keys(data).length > 0, {
        message: "Pelo menos um campo deve ser fornecido para atualização.",
    }),
});

export const listGeneralExpensesSchema = z.object({
    params: vehicleIdParamSchema.shape.params,
    // Add query params for filtering if needed (e.g., categoryId, dateStart, dateEnd)
    query: z.object({
        categoryId: z.string().uuid().optional(),
        dateStart: z.coerce.date().optional(),
        dateEnd: z.coerce.date().optional(),
        limit: z.coerce.number().optional(),
    }).optional(),
});

// --- Fueling Schemas ---

const fuelingBaseSchema = {
    cost: z.coerce.number({ required_error: "Custo total é obrigatório." }).positive("Custo deve ser positivo."),
    // Price per liter é OPCIONAL no input - será obrigatório se gasStationId não for fornecido
    pricePerLiter: z.coerce.number({ invalid_type_error: "Preço por litro deve ser um número." })
        .positive("Preço por litro deve ser positivo.")
        .optional(), // <<<<<<< MADE OPTIONAL HERE
    // volume: z.coerce.number({ invalid_type_error: "Volume deve ser um número." }).positive("Volume deve ser positivo.").optional(),
    timestamp: z.coerce.date({ invalid_type_error: "Timestamp inválido." }).optional(), // Defaults to now
    fuelTypeId: z.string({ required_error: "ID do tipo de combustível é obrigatório." }).uuid(),
    // odometer: z.coerce.number({ invalid_type_error: "Hodômetro deve ser um número." }).nonnegative("Hodômetro não pode ser negativo.").optional(),
    gasStationId: z.string().uuid({ message: "ID do posto inválido." }).optional(),
    // Latitude and Longitude are now REQUIRED input
    latitude: z.coerce.number({ required_error: "Latitude é obrigatória.", invalid_type_error: "Latitude inválida." }).min(-90).max(90),
    longitude: z.coerce.number({ required_error: "Longitude é obrigatória.", invalid_type_error: "Longitude inválida." }).min(-180).max(180),
};

// Schema de Criação atualizado com refine
export const createFuelingSchema = z.object({
    params: z.object({ vehicleId: z.string().uuid("ID do veículo inválido.") }),
    body: z.object(fuelingBaseSchema)
        // Refine para tornar pricePerLiter obrigatório SE gasStationId não for fornecido
        .refine(data => {
            // If gasStationId IS provided, pricePerLiter is optional (we'll try to look it up)
            if (data.gasStationId) {
                return true;
            }
            // If gasStationId is NOT provided, pricePerLiter MUST be provided
            return data.pricePerLiter !== undefined && data.pricePerLiter !== null;
        }, {
            message: "Preço por litro é obrigatório quando um posto não é selecionado.",
            path: ["pricePerLiter"], // Apply error specifically to pricePerLiter field
        })
});

// Schema de Atualização (pricePerLiter também opcional, lógica complexa no controller)
export const updateFuelingSchema = z.object({
    params: z.object({ fuelingId: z.string().uuid("ID do abastecimento inválido.") }),
    body: z.object({
        cost: fuelingBaseSchema.cost.optional(),
        pricePerLiter: fuelingBaseSchema.pricePerLiter.optional(), // Optional in input
        // volume: fuelingBaseSchema.volume.optional().nullable(),
        timestamp: fuelingBaseSchema.timestamp.optional(),
        fuelTypeId: fuelingBaseSchema.fuelTypeId.optional(),
        // odometer: fuelingBaseSchema.odometer.optional().nullable(),
        gasStationId: fuelingBaseSchema.gasStationId.optional().nullable(), // Allow linking/unlinking
        latitude: fuelingBaseSchema.latitude.optional(), // Allow updating location
        longitude: fuelingBaseSchema.longitude.optional(),
    }).refine(data => Object.keys(data).length > 0, {
        message: "Pelo menos um campo deve ser fornecido para atualização.",
    })
        // Add refine if both latitude/longitude must be updated together
        .refine(data => (data.latitude === undefined && data.longitude === undefined) || (data.latitude !== undefined && data.longitude !== undefined), {
            message: "Latitude e longitude devem ser fornecidas juntas para atualizar a localização.",
            path: ["latitude"], // Or apply to both?
        })
});

// ...

export const listFuelingsSchema = z.object({
    params: vehicleIdParamSchema.shape.params,
    // Add query params for filtering if needed (e.g., fuelTypeId, dateStart, dateEnd)
    query: z.object({
        fuelTypeId: z.string().uuid().optional(),
        dateStart: z.coerce.date().optional(),
        dateEnd: z.coerce.date().optional(),
    }).optional(),
});


// --- Types ---
export type CreateGeneralExpenseInput = z.infer<typeof createGeneralExpenseSchema>['body'];
export type CreateGeneralExpenseParams = z.infer<typeof createGeneralExpenseSchema>['params'];
export type ListGeneralExpensesParams = z.infer<typeof listGeneralExpensesSchema>['params'];
export type ListGeneralExpensesQuery = z.infer<typeof listGeneralExpensesSchema>['query'];
export type UpdateGeneralExpenseInput = z.infer<typeof updateGeneralExpenseSchema>['body'];
export type GeneralExpenseIdParams = z.infer<typeof generalExpenseIdParamSchema>['params'];

export type CreateFuelingInput = z.infer<typeof createFuelingSchema>['body'];
export type CreateFuelingParams = z.infer<typeof createFuelingSchema>['params'];
export type ListFuelingsParams = z.infer<typeof listFuelingsSchema>['params'];
export type ListFuelingsQuery = z.infer<typeof listFuelingsSchema>['query'];
export type UpdateFuelingInput = z.infer<typeof updateFuelingSchema>['body'];
export type FuelingIdParams = z.infer<typeof fuelingIdParamSchema>['params'];