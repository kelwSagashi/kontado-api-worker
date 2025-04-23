// src/validators/auth.validator.ts
import { z } from 'zod';

// Schema para Registro
export const registerSchema = z.object({
    body: z.object({
        name: z.string({ required_error: 'Nome é obrigatório.' })
            .min(1, { message: 'Nome não pode ser vazio.' }),
        username: z.string({ required_error: 'Nome de usuário é obrigatório.' })
            .min(3, { message: 'Nome de usuário deve ter pelo menos 3 caracteres.' })
        // Regex opcional para validar caracteres permitidos (ex: letras, números, _)
        // .regex(/^[a-zA-Z0-9_]+$/, { message: 'Nome de usuário pode conter apenas letras, números e _' })
        ,
        email: z.string({ required_error: 'Email é obrigatório.' })
            .email({ message: 'Formato de email inválido.' }),
        password: z.string({ required_error: 'Senha é obrigatória.' })
            .min(8, { message: 'Senha deve ter pelo menos 8 caracteres.' })
        // Opcional: Adicionar regex para complexidade (ex: maiúscula, minúscula, número)
        // .regex(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)[a-zA-Z\d]{8,}$/, { message: 'Senha deve conter maiúscula, minúscula e número.' }),
    }),
});

export const testSchema = z.object({
    body: z.object({
        password: z.string({ required_error: 'Senha é obrigatória.' })
            .min(1, { message: 'Senha deve ter pelo menos 8 caracteres.' })
    }),
});

// Schema para Login
export const loginSchema = z.object({
    body: z.object({
        email: z.string({ required_error: 'Email é obrigatório.' })
            .email({ message: 'Formato de email inválido.' }),
        password: z.string({ required_error: 'Senha é obrigatória.' })
            .min(1, { message: 'Senha não pode ser vazia.' }), // Mínimo 1, a verificação real é no compare
    }),
});

// Schema para Solicitar Reset de Senha
export const forgotPasswordSchema = z.object({
    body: z.object({
        email: z.string({ required_error: 'Email é obrigatório.' })
            .email({ message: 'Formato de email inválido.' }),
    }),
});

export const resetPasswordSchema = z.object({
    // Não tem mais params.token
    body: z.object({
        email: z.string({ required_error: 'Email é obrigatório.' })
            .email({ message: 'Formato de email inválido.' }),
        code: z.string({ required_error: 'Código de verificação é obrigatório.' })
            .length(6, { message: 'Código deve ter 6 dígitos.' }), // Ajuste o tamanho se necessário
        password: z.string({ required_error: 'Nova senha é obrigatória.' })
            .min(8, { message: 'Nova senha deve ter pelo menos 8 caracteres.' }),
        // .regex(...) // Validação de complexidade opcional
    }),
});


// Tipo inferido para uso no controlador (opcional, mas bom para type safety)
export type RegisterInput = z.infer<typeof registerSchema>['body'];
export type LoginInput = z.infer<typeof loginSchema>['body'];
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>['body'];
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>['body'];