// src/validators/report.validator.ts
import { z } from 'zod';

export const vehicleReportSchema = z.object({
    params: z.object({
        vehicleId: z.string().uuid("ID do veículo inválido."),
    }),
    query: z.object({
        // Optional date range filters
        startDate: z.coerce.date({ invalid_type_error: "Data inicial inválida."}).optional(),
        endDate: z.coerce.date({ invalid_type_error: "Data final inválida."}).optional(),
    }).optional(), // Make the whole query object optional
});
// NOVO: Schema para relatórios gerais do usuário
export const userReportSchema = z.object({
    query: z.object({
        // Permite filtrar por UM veículo opcionalmente
        vehicleId: z.string().uuid("ID do veículo inválido.").optional(),
        startDate: z.coerce.date({ invalid_type_error: "Data inicial inválida."}).optional(),
        endDate: z.coerce.date({ invalid_type_error: "Data final inválida."}).optional(),
        // Outros filtros possíveis: Mês/Ano específico?
        month: z.coerce.number().int().min(1).max(12).optional(),
        year: z.coerce.number().int().min(1900).max(2100).optional(),
    }).optional(), // Query params são opcionais
});


// Tipos
export type UserReportQuery = z.infer<typeof userReportSchema>['query'];

// Types
export type VehicleReportParams = z.infer<typeof vehicleReportSchema>['params'];
export type VehicleReportQuery = z.infer<typeof vehicleReportSchema>['query'];