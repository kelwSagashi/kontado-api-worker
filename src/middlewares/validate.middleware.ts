import { ZodError, AnyZodObject, z } from 'zod'
import { Context, Next } from 'hono'

export const validate = (schema: AnyZodObject) =>
    async (c: Context, next: Next) => {
        try {
            schema.parse({
                body: await c.req.json().catch(() => ({})),
                query: c.req.query(),
                params: c.req.param(),
            })
            await next()
        } catch (error) {
            if (error instanceof ZodError) {
                const formattedErrors = error.errors.map((err) => ({
                    path: err.path.join('.'),
                    message: err.message,
                }))
                return c.json(
                    {
                        message: 'Erro de validação.',
                        errors: formattedErrors,
                    },
                    400
                )
            }

            // Se não for ZodError, lança erro para o middleware global tratar
            throw error
        }
    }

// --- Shared Validation Error Handler ---
export const handleValidationFailure = (result: { success: boolean; error?: z.ZodError }, c: Context) => {
    if (!result.success) {
        const formattedErrors = result.error!.errors.map((err: any) => ({
            path: err.path.join('.'),
            message: err.message,
        }));
        return c.json({
            status: 'fail',
            message: 'Erro de validação.',
            errors: formattedErrors,
        }, 400);
    }
}