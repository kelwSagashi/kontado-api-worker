// src/controllers/user.controller.ts

import { zValidator } from '@hono/zod-validator';
import { hashPassword, comparePassword } from '../utils/password.util';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';
import { AppEnv, Hono } from 'hono';
import { protect } from 'middlewares/auth.middleware';
import next from 'middlewares/next.middleware';
import { prismaMiddleware } from 'middlewares/prisma.middleware';
import { changePasswordSchema, getUserByIdSchema, updateUserSchema } from 'validators/user.validator';

const userRoutesController = new Hono<AppEnv>();
// --- Obter Detalhes do Usuário Logado ---
userRoutesController.use(protect)
userRoutesController.use('*', prismaMiddleware);

userRoutesController.get(
    '/me',
    async (c) => {
        try {
            // O middleware 'protect' já garante que req.user existe e tem o id
            const userId = c.get('user').id;
            const prisma = c.get('prisma');

            const user = await prisma.user.findUnique({
                where: { id: userId },
                // Seleciona explicitamente os campos a serem retornados (IMPORTANTE: excluir senha)
                select: {
                    id: true,
                    name: true,
                    username: true,
                    email: true,
                    createdAt: true,
                    updatedAt: true,
                    roleId: true,
                    role: { select: { name: true } },
                    // Inclua outros campos não sensíveis ou relacionamentos se necessário
                    // ownedVehicles: { select: { id: true, nickname: true } } // Exemplo
                },
            });

            if (!user) {
                // Embora 'protect' deva evitar isso, é uma boa verificação
                return c.json({ message: 'Usuário não encontrado.' }, 404);
            }

            return c.json(user, 200);
        } catch (error) {
            next(error); // Passa para o middleware de erro global
        }
    }
);

// --- Atualizar Detalhes do Usuário Logado ---
// Adiciona tipo inferido para req.body
userRoutesController.patch(
    '/me',
    zValidator('json', updateUserSchema.shape.body),
    async (req) => {
        const userId = req.get('user').id;
        const prisma = req.get('prisma');
        // 'req.body' agora contém apenas os campos validados e opcionais (name?, username?, email?)
        // A validação de que pelo menos um campo foi enviado já foi feita pelo Zod (.refine)
        const dataToUpdate = req.req.valid('json');

        // A verificação de 'password' no corpo não é mais necessária, Zod schema já cuida disso

        try {
            // As verificações de conflito de email/username ainda são necessárias
            if (dataToUpdate.email) {
                const existingEmail = await prisma.user.findFirst({
                    where: { email: dataToUpdate.email, NOT: { id: userId } },
                });
                if (existingEmail) {
                    return req.json({ message: 'Este email já está em uso.' }, 409);
                }
            }
            if (dataToUpdate.username) {
                const existingUsername = await prisma.user.findFirst({
                    where: { username: dataToUpdate.username, NOT: { id: userId } },
                });
                if (existingUsername) {
                    return req.json({ message: 'Este nome de usuário já está em uso.' }, 409);
                }
            }

            // Atualizar o usuário - Prisma ignora campos 'undefined' no objeto 'data'
            const updatedUser = await prisma.user.update({
                where: { id: userId },
                data: dataToUpdate, // Passa o objeto validado diretamente
                select: { /* ...campos sem senha... */ },
            });

            return req.json(updatedUser, 200);
        } catch (error) {
            next(error);
        }
    }
);

// --- Deletar Conta do Usuário Logado ---
userRoutesController.delete(
    '/me',
    async (req) => {

        try {
            const userId = req.get('user').id;
            const prisma = req.get('prisma');
            // !! CUIDADO !! A exclusão é permanente.
            // Verifique as regras `onDelete` no seu schema.prisma para entender
            // o que acontece com os dados relacionados (veículos, notas, etc.).
            // Se `onDelete: Cascade` estiver definido nas relações (ex: em Vehicle.owner),
            // a exclusão do usuário excluirá também os veículos associados.
            // Se for `Restrict`, a exclusão falhará se houver veículos associados.
            // Considere a lógica de negócios: talvez você queira anonimizar ou
            // transferir a propriedade antes de excluir.

            // Exemplo simples de exclusão direta:
            await prisma.user.delete({
                where: { id: userId },
            });

            // Resposta padrão para DELETE bem-sucedido é 204 No Content
            return req.status(204);

            // Ou, se preferir enviar uma mensagem:
            // res.status(200).json({ message: 'Conta excluída com sucesso.' });

        } catch (error) {
            // Pode falhar devido a constraints (onDelete: Restrict)
            if (error instanceof PrismaClientKnownRequestError) {
                // Código P2014 indica violação de relação (geralmente por Restrict)
                if (error.code === 'P2014' || error.code === 'P2003') { // P2003 Foreign key constraint failed
                    return req.json({
                        message: 'Não é possível excluir a conta pois existem dados associados (ex: veículos). Remova-os ou transfira a propriedade primeiro.'
                    },
                        409
                    );

                }
            }
            next(error);
        }
    }
);

// --- Mudar Senha do Usuário Logado ---
userRoutesController.post(
    '/change-password',
    zValidator('json', changePasswordSchema.shape.body),
    async (req) => {

        try {
            const userId = req.get('user')!.id;
            const { currentPassword, newPassword } = req.req.valid('json');
            const prisma = req.get('prisma');
            // 1. Buscar o usuário e sua senha atual
            const user = await prisma.user.findUnique({
                where: { id: userId },
            });

            // Deveria sempre encontrar, pois 'protect' passou, mas verificamos
            if (!user) {
                return req.json({ message: 'Usuário não encontrado.' }, 404);
            }

            // 2. Verificar se a senha atual fornecida está correta
            const isMatch = await comparePassword(currentPassword, user.password);
            if (!isMatch) {
                return req.json({ message: 'Senha atual incorreta.' }, 401);
            }

            // 3. Hash da nova senha
            const hashedNewPassword = await hashPassword(newPassword);

            // 4. Atualizar a senha no banco
            await prisma.user.update({
                where: { id: userId },
                data: { password: hashedNewPassword },
            });

            // (Opcional) Invalidar tokens JWT antigos se você tiver um mecanismo de blocklist

            return req.json({ message: 'Senha alterada com sucesso.' }, 200);

        } catch (error) {
            next(error);
        }
    }
);

// --- (Opcional) Obter Usuário por ID (Exemplo) ---
userRoutesController.get(
    '/:id',
    zValidator('param', getUserByIdSchema.shape.params),
    async (req) => {
        try {
            const { id } = req.req.valid('param');
            const prisma = req.get('prisma');
            const user = await prisma.user.findUnique({
                where: { id },
                select: { // Excluir campos sensíveis
                    id: true,
                    name: true,
                    username: true,
                    // email: true, // Talvez não retornar email publicamente
                    createdAt: true,
                }
            });

            if (!user) {
                return req.json({ message: 'Usuário não encontrado.' }, 404);
            }
            return req.json(user, 200);
        } catch (error) {
            next(error);
        }
    }
);


export default userRoutesController;