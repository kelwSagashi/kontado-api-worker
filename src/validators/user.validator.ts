// src/validators/user.validator.ts
import { z } from 'zod';

// Schema para Atualização de Dados do Usuário (PATCH /me)
export const updateUserSchema = z.object({
    body: z.object({
        name: z.string()
            .min(1, { message: 'Nome não pode ser vazio.' })
            .optional(), // Torna o campo opcional na requisição
        username: z.string()
            .min(3, { message: 'Nome de usuário deve ter pelo menos 3 caracteres.' })
            // .regex(/^[a-zA-Z0-9_]+$/, { message: 'Nome de usuário pode conter apenas letras, números e _' })
            .optional(),
        email: z.string()
            .email({ message: 'Formato de email inválido.' })
            .optional(),
        // NÃO incluir 'password' aqui para evitar atualização por esta rota
    }).refine(data => Object.keys(data).length > 0, { // Garante que pelo menos um campo foi enviado
        message: "Pelo menos um campo (nome, username ou email) deve ser fornecido para atualização.",
        // path: [], // Pode definir um path geral ou omitir
    }),
});


// Schema para Mudar a Senha (POST /change-password)
export const changePasswordSchema = z.object({
    body: z.object({
        currentPassword: z.string({ required_error: 'Senha atual é obrigatória.' })
            .min(1, { message: 'Senha atual não pode ser vazia.' }),
        newPassword: z.string({ required_error: 'Nova senha é obrigatória.' })
            .min(8, { message: 'Nova senha deve ter pelo menos 8 caracteres.' }),
        // .regex(...) // Adicione validação de complexidade se desejar
    }).refine(data => data.currentPassword !== data.newPassword, {
        message: 'A nova senha deve ser diferente da senha atual.',
        path: ['newPassword'], // Indica qual campo está relacionado ao erro
    }),
});

// Schema para Obter Usuário por ID (GET /:id) - Opcional
export const getUserByIdSchema = z.object({
    params: z.object({
        id: z.string().uuid({ message: "ID de usuário inválido (deve ser UUID)." }),
    }),
});


// Tipos inferidos para uso nos controladores
export type UpdateUserInput = z.infer<typeof updateUserSchema>['body'];
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>['body'];
export type GetUserByIdParams = z.infer<typeof getUserByIdSchema>['params'];