// src/validators/trip.validator.ts (Novo Arquivo)
import { z } from 'zod';

export const createTripSchema = z.object({
    params: z.object({
        vehicleId: z.string().uuid("ID do veículo inválido."),
    }),
    body: z.object({
        startTime: z.coerce.date({ required_error: "Hora de início é obrigatória." }),
        endTime: z.coerce.date({ required_error: "Hora de fim é obrigatória." }),
        distance: z.coerce.number({ required_error: "Distância é obrigatória." })
                    .positive({ message: "Distância deve ser positiva." }),
        // Taxa de consumo USADA para esta viagem específica (ex: app detectou que era cidade)
        // Ou poderia ser um enum 'city' | 'road' e a API buscaria a taxa do veículo?
        // Enviar a taxa usada é mais explícito.
        consumptionRateUsed: z.coerce.number({ required_error: "Taxa de consumo usada é obrigatória." })
                                .positive({ message: "Taxa de consumo deve ser positiva." }),
        // Opcionais
        routePath: z.any().optional(), // Aceita qualquer estrutura JSON por enquanto
        notes: z.string().optional(),
    }).refine(data => data.endTime >= data.startTime, {
        message: "Hora de fim deve ser maior ou igual à hora de início.",
        path: ["endTime"],
    }),
});

// Schema para Parâmetro :vehicleId
const vehicleIdParamSchema = z.object({
    vehicleId: z.string().uuid("ID do veículo inválido."),
});

// Schema para Parâmetro :tripId
const tripIdParamSchema = z.object({
    tripId: z.string().uuid("ID da viagem inválido."),
});

// Schema para Listar Trips
export const listTripsSchema = z.object({
    params: vehicleIdParamSchema,
    query: z.object({
        startDate: z.coerce.date().optional(),
        endDate: z.coerce.date().optional(),
        page: z.coerce.number().int().positive().default(1).optional(),
        limit: z.coerce.number().int().positive().max(50).default(15).optional(),
    }).optional(),
});

// Schema para Obter/Deletar Trip por ID
export const getOrDeleteTripSchema = z.object({
    // Combina params de vehicleId e tripId - a rota definirá a estrutura
    params: vehicleIdParamSchema.merge(tripIdParamSchema),
});

// Schema para Atualizar Trip
export const updateTripSchema = z.object({
    params: vehicleIdParamSchema.merge(tripIdParamSchema),
    body: z.object({ // Campos editáveis (opcionais)
        startTime: z.coerce.date().optional(),
        endTime: z.coerce.date().optional(),
        distance: z.coerce.number().positive("Distância deve ser positiva.").optional(),
        consumptionRateUsed: z.coerce.number().positive("Taxa de consumo deve ser positiva.").optional(),
        routePath: z.any().optional().nullable(), // Permitir limpar path
        notes: z.string().optional().nullable(), // Permitir limpar notas
    }).refine(data => Object.keys(data).length > 0, {
        message: "Pelo menos um campo deve ser fornecido para atualização.",
    })
    // Validar consistência das datas se ambas forem fornecidas
    .refine(data => (data.startTime === undefined || data.endTime === undefined) || data.endTime >= data.startTime, {
        message: "Hora de fim deve ser maior ou igual à hora de início, se ambas forem atualizadas.",
        path: ["endTime"],
    }),
});

// Tipos Inferidos
export type CreateTripInput = z.infer<typeof createTripSchema>['body'];
export type CreateTripParams = z.infer<typeof createTripSchema>['params'];
export type ListTripsParams = z.infer<typeof listTripsSchema>['params'];
export type ListTripsQuery = z.infer<typeof listTripsSchema>['query'];
export type GetOrDeleteTripParams = z.infer<typeof getOrDeleteTripSchema>['params'];
export type UpdateTripParams = z.infer<typeof updateTripSchema>['params'];
export type UpdateTripInput = z.infer<typeof updateTripSchema>['body'];