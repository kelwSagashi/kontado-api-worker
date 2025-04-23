// src/validators/station.validator.ts
import { z } from 'zod';
import { GasStationStatus } from '@prisma/client';

const latitudeSchema = z.number({ required_error: "Latitude é obrigatória.", invalid_type_error: "Latitude deve ser um número." }).min(-90).max(90);
const longitudeSchema = z.number({ required_error: "Longitude é obrigatória.", invalid_type_error: "Longitude deve ser um número." }).min(-180).max(180);

// Schema for Path Parameter (vehicleId)
const paramsSchema = z.object({
    proposalId: z.string().uuid({ message: "ID inválido (deve ser UUID)." }),
});

export const proposalIdSchema = z.object({
    params: paramsSchema,
});

// Schema for Path Parameter (vehicleId)
const paramsStationSchema = z.object({
    stationId: z.string().uuid({ message: "ID inválido (deve ser UUID)." }),
});

export const stationIdSchema = z.object({
    params: paramsStationSchema,
});

export const StationPriceSchema = z.object({
    price: z.coerce.number().positive({ message: "Preço deve ser positivo" }),
    // gasStationId: z.string().uuid({ message: "ID inválido (deve ser UUID)." }).optional(),
    fuelTypeId: z.string().uuid({ message: "ID inválido (deve ser UUID)." }),
    proposerId: z.string().uuid({ message: "ID inválido (deve ser UUID)." }).optional(),

});

export const EditStationPriceSchema = z.object({
    price: z.coerce.number().positive({ message: "Preço deve ser positivo" }),
    stationPriceId: z.string().uuid({ message: "ID inválido (deve ser UUID)." }),
    fuelTypeId: z.string().uuid({ message: "ID inválido (deve ser UUID)." }),
    proposerId: z.string().uuid({ message: "ID inválido (deve ser UUID)." }).optional(),

});
// Define reusable address schema part
const addressSchemaPart = {
    street: z.string({ required_error: "Logradouro é obrigatório." }).min(1),
    number: z.string({ required_error: "Número é obrigatório." }).min(1), // Min 1 allows "SN"
    complement: z.string().optional(),
    neighborhood: z.string({ required_error: "Bairro é obrigatório." }).min(1),
    city: z.string({ required_error: "Cidade é obrigatória." }).min(1),
    state: z.string({ required_error: "Estado (UF) é obrigatório." })
        .length(2, { message: "Estado deve ter 2 caracteres (UF)." }), // Assuming 2-char UF for BR
    postalCode: z.string({ required_error: "CEP é obrigatório." })
        .regex(/^((\d{5}-?\d{3})|)$/, { message: "Formato de CEP inválido (ex: 12345-678 ou 12345678) ou deve ser vazio." })
        .optional(), // Basic BR CEP format
    country: z.string().default("BRASIL"), // Default set in Prisma
};

// Schema for Proposing Station Creation
export const createGasStationSchema = z.object({
    body: z.object({
        name: z.string({ required_error: "Nome do posto é obrigatório." }).min(1),
        latitude: latitudeSchema,
        longitude: longitudeSchema,
        // Include normalized address fields
        ...addressSchemaPart,
        stationPrices: z.array(StationPriceSchema).default([]),
        reason: z.string({ required_error: "Justificativa é obrigatória." }).min(5),
    }),
});

// Schema para Reportar Preço (agora cria a entidade diretamente)
export const reportStationPriceSchema = z.object({
    params: z.object({
        stationId: z.string().uuid({ message: "ID do posto inválido." }),
    }),
    body: z.object({
        fuelTypeId: z.string({ required_error: "ID do tipo de combustível é obrigatório." }).uuid(),
        price: z.coerce.number({ required_error: "Preço é obrigatório." })
            .positive({ message: "Preço deve ser positivo." }),
        reason: z.string().optional(), // Opcional: Justificativa (ex: "Preço da bomba")
        // Timestamp é automático no controller/DB
    }),
});

// Schema para GET /stations (Query Params)
export const getStationsSchema = z.object({
    query: z.object({
        latitude: latitudeSchema.optional(),
        longitude: longitudeSchema.optional(),
        radius: z.coerce.number().positive("Raio deve ser positivo.").optional(),
        // Filtro por status (para admins/revisores talvez?)
        status: z.nativeEnum(GasStationStatus).optional(),
        name: z.string().optional(),
        // Paginação?
    }).refine(data => (data.latitude !== undefined && data.longitude !== undefined && data.radius !== undefined) || (data.latitude === undefined && data.longitude === undefined && data.radius === undefined), {
        message: "Latitude, longitude e raio devem ser fornecidos juntos.",
    }),
});

// Schema para ID Param genérico
export const idParamSchema = (paramName: string, entityName: string) => z.object({
    params: z.object({
        [paramName]: z.string().uuid({ message: `ID inválido para ${entityName}.` }),
    }),
});

// Schema para Propor Edição a um Posto Existente
export const proposeEditStationSchema = z.object({
    params: z.object({
        stationId: z.string().uuid({ message: "ID do posto inválido." }),
    }),
    body: z.object({
        name: z.string({ required_error: "Nome do posto é obrigatório." }).min(1),
        latitude: latitudeSchema,
        longitude: longitudeSchema,
        // Include normalized address fields
        ...addressSchemaPart,
        stationPrices: z.array(EditStationPriceSchema).default([]),
        reason: z.string({ required_error: "Justificativa é obrigatória." }).min(5),
    }).refine(data => Object.keys(data).some(key => key !== 'reason'), {
        message: "Pelo menos um campo (nome, lat, lon, ou endereço) deve ser proposto para edição.",
    }),
});

export type ProposeEditStationInput = z.infer<typeof proposeEditStationSchema>['body'];
export type ProposeEditStationParams = z.infer<typeof proposeEditStationSchema>['params'];

// Tipos
export type CreateGasStationInput = z.infer<typeof createGasStationSchema>['body'];
export type ReportStationPriceInput = z.infer<typeof reportStationPriceSchema>['body'];
export type ReportStationPriceParams = z.infer<typeof reportStationPriceSchema>['params'];
export type GetStationsQuery = z.infer<typeof getStationsSchema>['query'];

export type StationIdParams = z.infer<typeof stationIdSchema>['params'];