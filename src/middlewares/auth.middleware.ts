// src/middlewares/auth.middleware.ts
import { MiddlewareHandler } from 'hono';
import { verifyToken } from '../utils/jwt.utils'; // Assuming this exists and works
import AppError from '../utils/AppError';
import { PrismaD1 } from '@prisma/adapter-d1';
import { PrismaClient } from '@prisma/client';
import { AuthVariables } from 'types';

// Define the type for variables expected/set by this middleware
// Use the types defined in hono.d.ts


export const protect: MiddlewareHandler<AuthVariables> = async (c, next) => {
    let token;

    // 1. Get token from header
    const authHeader = c.req.header('Authorization');
    if (authHeader && authHeader.startsWith('Bearer ')) {
        token = authHeader.split(' ')[1];
    }

    if (!token) {
        // In Hono, return a Response object to stop execution and send the response
        throw new AppError('Não autorizado. Token não fornecido.', 401);
        // OR: return c.json({ status: 'fail', message: 'Não autorizado. Token não fornecido.' }, 401);
    }

    try {
        // 2. Verify token
        const decoded = verifyToken(token); // Assuming verifyToken throws on error or returns null/undefined

        if (!decoded || !decoded.userId || !decoded.roleId) {
            throw new AppError('Não autorizado. Token inválido ou expirado.', 401);
            // OR: return c.json({ status: 'fail', message: 'Não autorizado. Token inválido ou expirado.' }, 401);
        }

        const adapter = new PrismaD1(c.env.DB);
        const prisma = new PrismaClient({ adapter });

        // 3. (Optional) Check if user still exists
        const currentUser = await prisma.user.findUnique({
            where: { id: decoded.userId },
            select: { id: true }, // Minimal selection
        });

        if (!currentUser) {
            throw new AppError('Não autorizado. Usuário não encontrado.', 401);
            // OR: return c.json({ status: 'fail', message: 'Não autorizado. Usuário não encontrado.' }, 401);
        }

        // 4. Set user information on context variables
        c.set('user', {
            id: decoded.userId,
            roleId: decoded.roleId,
        });

        // Proceed to the next middleware/handler
        await next();

    } catch (error: any) {
        // Handle JWT errors specifically if verifyToken throws them
        if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
            throw new AppError(`Não autorizado. ${error.message}`, 401);
            // OR: return c.json({ status: 'fail', message: `Não autorizado. ${error.message}` }, 401);
        }
        // Re-throw other errors to be caught by the global error handler
        console.error("Erro no middleware de proteção:", error);
        throw new AppError('Erro interno na verificação de autenticação.', 500);
        // OR: return c.json({ status: 'error', message: 'Erro interno na verificação de autenticação.' }, 500);
    }
};