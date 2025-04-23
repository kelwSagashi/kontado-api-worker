// import { hashPassword, comparePassword } from '../utils/password.util';
import crypto from 'crypto';
import { generateToken } from '../utils/jwt.utils';
import { AppEnv, Hono } from 'hono';
import {
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
  testSchema
} from 'validators/auth.validator';
import AppError from 'utils/AppError';
import { PrismaD1 } from '@prisma/adapter-d1';
import { PrismaClient } from '@prisma/client';
import { zValidator } from '@hono/zod-validator';
import { comparePassword, hashPassword } from 'utils/password.util';

// --- Função auxiliar para gerar OTP (ex: 6 dígitos) ---
const generateOtp = (length: number = 6): string => {
  if (length <= 0) {
    throw new Error("OTP length must be positive");
  }
  // Garante que o resultado sempre tenha 'length' dígitos, preenchendo com 0 à esquerda se necessário
  const min = 0; // Math.pow(10, length - 1) se quiser garantir que não comece com 0
  const max = Math.pow(10, length) - 1;
  const otp = crypto.randomInt(min, max + 1); // +1 porque randomInt é exclusivo no limite superior
  return otp.toString().padStart(length, '0');
};

const authRoutesController = new Hono<AppEnv>();

// authRoutes.use('*', prismaMiddleware); 

authRoutesController.post(
  '/verify-test',
  zValidator('json', testSchema.shape.body), // <-- Apply validator middleware HERE
  async (c) => {
    try {
      const { password } = c.req.valid('json');
      const hashedPassword = await hashPassword(password);

      const compared = await comparePassword(password, '$2b$10$ERCdvWsf3tCKSEc0tQwjru2Wp4qw4vMdBaX4RG2aDLT3zjWRArDha');

      return c.json({ hashedPassword, password, compared });
    } catch (error) {
      // Re-throw AppErrors or handle other errors
      if (error instanceof AppError) throw error;
      // Handle specific Prisma errors if necessary (like unique constraints if check fails somehow)
      console.error("Register Error:", error);
      throw new AppError('Erro', 500); // Default internal error
    }
  }
);


authRoutesController.post(
  '/register',
  zValidator('json', registerSchema.shape.body), // <-- Apply validator middleware HERE
  async (c) => {
    // Os dados já foram validados pelo middleware 'validate(registerSchema)'
    const validatedData = c.req.valid('json');
    const { name, username, email, password } = validatedData;

    try {
      const adapter = new PrismaD1(c.env.DB);
      const prisma = new PrismaClient({ adapter });

      const existingUser = await prisma.user.findFirst({
        where: { OR: [{ email }, { username }] },
      });

      if (existingUser) {
        return c.json({ message: 'Email ou nome de usuário já cadastrado.' }, 409);
      }

      const defaultRole = await prisma.role.findUnique({
        where: { name: 'BASIC_USER' }, // Nome definido no seed
      });

      if (!defaultRole) {
        console.error("ERRO CRÍTICO: Role 'BASIC_USER' não encontrado no banco de dados. Execute o seed.");
        throw new Error('Erro interno ao configurar usuário.');
      }

      const hashedPassword = await hashPassword(password);

      const newUser = await prisma.user.create({
        data: {
          name,
          username,
          email,
          password: hashedPassword,
          roleId: defaultRole.id,
        },
        select: {
          id: true,
          name: true,
          username: true,
          email: true,
          createdAt: true,
          role: {
            select: {
              name: true
            }
          }
        },
      });

      return c.json(newUser, 201);
    } catch (error) {
      // Re-throw AppErrors or handle other errors
      if (error instanceof AppError) throw error;
      // Handle specific Prisma errors if necessary (like unique constraints if check fails somehow)
      console.error("Register Error:", error);
      throw new AppError('Erro ao registrar usuário.', 500); // Default internal error
    }
  }
);


// --- Login (Sign In) ---
authRoutesController.post(
  '/login',
  zValidator('json', loginSchema.shape.body),
  async (c) => {
    // Dados validados pelo middleware 'validate(loginSchema)'
    const { email, password } = c.req.valid('json');

    try {
      const adapter = new PrismaD1(c.env.DB);
      const prisma = new PrismaClient({ adapter });
      const user = await prisma.user.findUnique({
        where: { email },
        select: { id: true, name: true, username: true, email: true, password: true, roleId: true, role: { select: { name: true } } } // Inclui roleId e nome do role
      });

      if (!user || !(await comparePassword(password, user.password))) {
        return c.json({ message: 'Credenciais inválidas.' }, 401);
      }

      const JWT_SECRET = c.env.JWT_SECRET || 'seu_super_segredo_jwt_aqui';
      const JWT_EXPIRES_IN = c.env.JWT_EXPIRES_IN || "7d";
      const tokenPayload = { userId: user.id, roleId: user.roleId };
      const token = generateToken(tokenPayload, JWT_SECRET, JWT_EXPIRES_IN);
      // const token = '';

      return c.json({
        token,
        user: {
          id: user.id,
          name: user.name,
          username: user.username,
          email: user.email,
          role: user.role.name,
          roleId: user.roleId
        },
      }, 200);
    } catch (error) {
      // Re-throw AppErrors or handle other errors
      if (error instanceof AppError) throw error;
      // Handle specific Prisma errors if necessary (like unique constraints if check fails somehow)
      console.error("Register Error:", error);
      throw new AppError('Erro ao logar usuário.', 500); // Default internal error
    }
  }

);



// --- Solicitar Reset de Senha (Forgot Password) ---
authRoutesController.post(
  '/forgot-password',
  zValidator('json', forgotPasswordSchema.shape.body),
  async (c) => {
    const { email } = c.req.valid('json');

    try {
      const adapter = new PrismaD1(c.env.DB);
      const prisma = new PrismaClient({ adapter });

      const user = await prisma.user.findUnique({
        where: { email },
      });

      if (!user) {
        console.log(`Tentativa de reset para email não cadastrado: ${email}`);
        c.json({ message: 'Se o email estiver cadastrado, você receberá um código para redefinir sua senha.' }, 200);
        return;
      }

      // 1. Gerar um código OTP seguro (ex: 6 dígitos)
      const resetCode = generateOtp(6);

      // 2. Hash do código antes de salvar no banco
      // Usar bcrypt é possível, mas para OTPs curtos e de curta duração, SHA256 é comum e mais rápido.
      // Se usar bcrypt, lembre-se que a comparação será assíncrona.
      // Vamos usar SHA256 aqui para simplicidade na comparação síncrona depois.
      const hashedCode = crypto
        .createHash('sha256')
        .update(resetCode) // Hash do código REAL
        .digest('hex');

      // 3. Definir data de expiração (ex: 10 minutos)
      const resetExpires = new Date(Date.now() + 10 * 60 * 1000); // 10 minutos

      // 4. Salvar HASH e expiração no usuário
      await prisma.user.update({
        where: { id: user.id },
        data: {
          passwordResetToken: hashedCode, // Salva o HASH
          passwordResetExpires: resetExpires,
        },
      });

      // 5. Montar e enviar o email com o CÓDIGO REAL
      const message = `
      <p>Você solicitou a redefinição de senha.</p>
      <p>Seu código de verificação é: <strong>${resetCode}</strong></p>
      <p>Este código expirará em 10 minutos.</p>
      <p>Insira este código no aplicativo para definir uma nova senha.</p>
      <p>Se você não solicitou isso, ignore este email.</p>
    `;

      // **!! DESCOMENTE !!** para enviar email
      /*
      await sendEmail({
         to: user.email,
         subject: 'Código de Redefinição de Senha - Meu App',
         html: message,
      });
      */
      console.log(`Código de Reset para ${email} (remover em prod): ${resetCode}`); // Para DEBUG

      c.json({ message: 'Se o email estiver cadastrado, você receberá um código para redefinir sua senha.' }, 200);
      return;
    } catch (error) {
      // Re-throw AppErrors or handle other errors
      if (error instanceof AppError) throw error;
      // Handle specific Prisma errors if necessary (like unique constraints if check fails somehow)
      console.error("Register Error:", error);
      throw new AppError('Erro ao registrar usuário.', 500); // Default internal error
    }
  }
);

// --- Resetar Senha (Verifica Código e Reseta) ---
authRoutesController.post(
  '/forgot-password',
  zValidator('json', resetPasswordSchema),
  async (c) => {
    // email, code, password validados pelo middleware 'validate(resetPasswordSchema)'
    const { email, code, password } = c.req.valid('json').body;

    try {
      const adapter = new PrismaD1(c.env.DB);
      const prisma = new PrismaClient({ adapter });
      // 1. Hash do código recebido para comparar com o banco
      const hashedCode = crypto
        .createHash('sha256')
        .update(code) // Hash do código que o usuário digitou
        .digest('hex');

      // 2. Encontrar usuário pelo EMAIL E verificar HASH do código E expiração
      const user = await prisma.user.findFirst({
        where: {
          email: email, // Busca pelo email fornecido
          passwordResetToken: hashedCode, // Compara com o HASH armazenado
          passwordResetExpires: { gt: new Date() }, // Verifica se ainda é válido
        },
      });

      // Se não encontrou usuário que satisfaça TODAS as condições
      if (!user) {
        // Verificar separadamente se o usuário existe mas o código/expiração falhou
        // para talvez dar um feedback mais específico ou implementar rate limiting/bloqueio
        const userExists = await prisma.user.findUnique({ where: { email } });
        if (userExists) {
          // Usuário existe, mas o código está errado ou expirou
          // Aqui você pode querer incrementar uma contagem de tentativas falhas
          console.log(`Tentativa de reset falhou para ${email} (código/expiração inválido)`);
        }
        c.json({ message: 'Código inválido ou expirado, ou email não corresponde.' }, 400);
        return;
      }

      // 3. Hash da nova senha
      const hashedPassword = await hashPassword(password);

      // 4. Atualizar senha do usuário E limpar campos de reset
      await prisma.user.update({
        where: { id: user.id }, // Usa o ID do usuário encontrado
        data: {
          password: hashedPassword,
          passwordResetToken: null, // Limpa o código
          passwordResetExpires: null, // Limpa a expiração
        },
      });

      // (Opcional) Enviar email de confirmação de alteração de senha

      c.json({ message: 'Senha redefinida com sucesso.' }, 200);
      return;
    } catch (error) {
      // Re-throw AppErrors or handle other errors
      if (error instanceof AppError) throw error;
      // Handle specific Prisma errors if necessary (like unique constraints if check fails somehow)
      console.error("Register Error:", error);
      throw new AppError('Erro ao registrar usuário.', 500); // Default internal error
    }
  }
);

export default authRoutesController;