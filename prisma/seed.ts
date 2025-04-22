// // prisma/seed.ts
// import { PrismaClient, Prisma } from '@prisma/client';
// import PERMISSION from '../src/utils/permissions'
// import ROLES from '../src/utils/roles'

// const prisma = new PrismaClient();

// // Defina suas permissões aqui (use a convenção <recurso>:<ação>:<escopo?>)
// const permissions: Prisma.PermissionCreateInput[] = [
//   // User Permissions
//   { name: PERMISSION.user.read, description: 'Ler os próprios dados de usuário' },
//   { name: PERMISSION.user.update, description: 'Atualizar os próprios dados de usuário' },
//   { name: PERMISSION.user.delete, description: 'Deletar a própria conta de usuário' },
//   { name: PERMISSION.user.change_password, description: 'Alterar a própria senha' },
//   { name: PERMISSION.user.any, description: 'Acessar qualquer rota permitida para o usuário.' },

//   //budgets permisions
//   { name: PERMISSION.budget.create, description: 'Criar orçamentos' },
//   { name: PERMISSION.budget.read, description: 'Ler os próprios orçamentos' },
//   { name: PERMISSION.budget.update, description: 'Atualizar os próprios orçamentos' },
//   { name: PERMISSION.budget.delete, description: 'Deletar os próprios orçamentos' },
//   { name: PERMISSION.budget.read, description: 'Consultar status (gastos vs limite) dos próprios orçamentos' },

//   // Vehicle Permissions
//   { name: PERMISSION.vehicle.create, description: 'Criar um novo veículo' },
//   { name: PERMISSION.vehicle.read, description: 'Ler dados de veículos próprios ou autorizados' },
//   { name: PERMISSION.vehicle.update, description: 'Atualizar dados de veículos próprios ou autorizados' },
//   { name: PERMISSION.vehicle.delete, description: 'Deletar veículos próprios' },

//   // Note permissions
//   { name: PERMISSION.note.create, description: 'Criar notas ou lembretes para veículos autorizados' },
//   { name: PERMISSION.note.read, description: 'Ler notas/lembretes de veículos autorizados' },
//   { name: PERMISSION.note.update, description: 'Atualizar notas/lembretes de veículos autorizados' },
//   { name: PERMISSION.note.delete, description: 'Deletar notas/lembretes de veículos autorizados' },
//   { name: PERMISSION.todo.manage, description: 'Adicionar, atualizar ou deletar tarefas (To-Do) em notas/lembretes autorizados' },

//   // Community / Station Permissions
//   { name: PERMISSION.station.create, description: 'Propor a criação de um posto' },
//   { name: PERMISSION.station.update, description: 'Propor a atualização de um posto' },

//   // Price
//   { name: PERMISSION.price.update, description: 'Propor a atualização de um preço' },
//   { name: PERMISSION.price.read, description: 'Ler preços de combustíveis' },

//   // Proposal
//   { name: PERMISSION.review.review, description: 'Revisar propostas da comunidade (votar)' },
//   { name: PERMISSION.review.read_pending, description: 'Ler propostas pendentes para revisão' },
//   { name: PERMISSION.review.read_details, description: 'Ler detalhes de uma proposta específica (incluindo votos)' },

//   // Expense
//   { name: PERMISSION.expense.create, description: 'Adicionar gastos (gerais ou abastecimento) a veículos autorizados' },
//   { name: PERMISSION.expense.read, description: 'Ler gastos de veículos autorizados' },
//   { name: PERMISSION.expense.update, description: 'Atualizar gastos de veículos autorizados' },
//   { name: PERMISSION.expense.delete, description: 'Deletar gastos de veículos autorizados' },

//   // Premium Features 
//   { name: PERMISSION.feature.advanced_report, description: 'Acessar relatórios avançados' },
//   { name: PERMISSION.feature.price_comparison, description: 'Acessar comparação de preços de combustiveis' },
//   { name: PERMISSION.feature.authorize, description: 'Autorizar outro usuário a gerenciar veículo próprio' },

//   // Admin Permissions
//   { name: PERMISSION.admin.read, description: 'Ler dados de qualquer usuário' },
//   { name: PERMISSION.admin.update, description: 'Atualizar dados de qualquer usuário' },
//   { name: PERMISSION.admin.delete, description: 'Deletar qualquer usuário' },
//   { name: PERMISSION.admin.assign, description: 'Atribuir roles a usuários' },
//   { name: PERMISSION.admin.permission_manage, description: 'Gerenciar roles e permissões' },
//   { name: PERMISSION.admin.porposal_manage, description: 'Gerenciar (aprovar/rejeitar diretamente) propostas' },

//   { name: PERMISSION.admin.read_any, description: 'Ler qualquer coisa' },
//   { name: PERMISSION.admin.create_any, description: 'Criar qualquer coisa, serve para gerenciar dados que são apenas de leitura para usuários' },
//   { name: PERMISSION.admin.update_any, description: 'Atualizar qualquer coisa, serve para gerenciar dados que são apenas de leitura para usuários' },
//   { name: PERMISSION.admin.delete_any, description: 'Deletar qualquer coisa, serve para gerenciar dados que são apenas de leitura para usuários' },
// ];

// // Defina seus Roles aqui
// const roles: Prisma.RoleCreateInput[] = [
//   { name: ROLES.BASIC_USER, description: 'Usuário com funcionalidades básicas' },
//   { name: ROLES.PREMIUM_USER, description: 'Usuário com acesso a funcionalidades premium' },
//   { name: ROLES.ADMIN, description: 'Administrador do sistema' },
// ];

// async function main() {
//   console.log(`Start seeding ...`);

//   // 1. Criar Permissões (ou encontrar existentes)
//   console.log('Seeding permissions...');
//   const createdPermissions: { [key: string]: string } = {}; // name -> id
//   for (const p of permissions) {
//     const permission = await prisma.permission.upsert({
//       where: { name: p.name },
//       update: {},
//       create: p,
//     });
//     createdPermissions[permission.name] = permission.id;
//     console.log(`Created/Found permission ${permission.name} (ID: ${permission.id})`);
//   }

//   // 2. Criar Roles (ou encontrar existentes)
//   console.log('\nSeeding roles...');
//   const createdRoles: { [key: string]: string } = {}; // name -> id
//   for (const r of roles) {
//     const role = await prisma.role.upsert({
//       where: { name: r.name },
//       update: {},
//       create: r,
//     });
//     createdRoles[role.name] = role.id;
//     console.log(`Created/Found role ${role.name} (ID: ${role.id})`);
//   }

//   // 3. Atribuir Permissões aos Roles na tabela RolePermission
//   console.log('\nAssigning permissions to roles...');

//   // Permissões do BASIC_USER
//   const basicUserPermissions = [
//     // user
//     PERMISSION.user.read,
//     PERMISSION.user.update,
//     PERMISSION.user.delete,
//     PERMISSION.user.change_password,
//     PERMISSION.user.any,

//     // budget
//     PERMISSION.budget.create,
//     PERMISSION.budget.read,
//     PERMISSION.budget.update,
//     PERMISSION.budget.delete,

//     // station
//     PERMISSION.station.create,
//     PERMISSION.station.update,

//     // proposal
//     PERMISSION.review.review,
//     PERMISSION.review.read_pending,
//     PERMISSION.review.read_details,

//     // vehicle
//     PERMISSION.vehicle.create,
//     PERMISSION.vehicle.read,
//     PERMISSION.vehicle.update,
//     PERMISSION.vehicle.delete,

//     // price
//     PERMISSION.price.read,
//     PERMISSION.price.update,

//     // note
//     PERMISSION.note.create,
//     PERMISSION.note.read,
//     PERMISSION.note.update,
//     PERMISSION.note.delete,
//     PERMISSION.todo.manage,

//     // expense
//     PERMISSION.expense.create,
//     PERMISSION.expense.read,
//     PERMISSION.expense.update,
//     PERMISSION.expense.delete,

//   ];

//   for (const permName of basicUserPermissions) {
//     await prisma.rolePermission.upsert({
//       where: { roleId_permissionId: { roleId: createdRoles['BASIC_USER'], permissionId: createdPermissions[permName] } },
//       update: {},
//       create: { roleId: createdRoles['BASIC_USER'], permissionId: createdPermissions[permName] },
//     });
//     console.log(`Assigned ${permName} to BASIC_USER`);
//   }

//   // Permissões adicionais do PREMIUM_USER (herda as do BASIC + as premium)
//   const premiumUserPermissions = [
//     ...basicUserPermissions, // Inclui todas as básicas
//     PERMISSION.feature.advanced_report,
//     PERMISSION.feature.authorize,
//     PERMISSION.feature.price_comparison,
//   ];

//   for (const permName of premiumUserPermissions) {
//     if (createdPermissions[permName]) { // Garante que a permissão existe
//       await prisma.rolePermission.upsert({
//         where: { roleId_permissionId: { roleId: createdRoles['PREMIUM_USER'], permissionId: createdPermissions[permName] } },
//         update: {},
//         create: { roleId: createdRoles['PREMIUM_USER'], permissionId: createdPermissions[permName] },
//       });
//       console.log(`Assigned ${permName} to PREMIUM_USER`);
//     }
//   }


//   // Permissões do ADMIN (todas!)
//   for (const permName of Object.keys(createdPermissions)) {
//     await prisma.rolePermission.upsert({
//       where: { roleId_permissionId: { roleId: createdRoles['ADMIN'], permissionId: createdPermissions[permName] } },
//       update: {},
//       create: { roleId: createdRoles['ADMIN'], permissionId: createdPermissions[permName] },
//     });
//     console.log(`Assigned ${permName} to ADMIN`);
//   }

//   // --- ADICIONAR ESTA SEÇÃO PARA TIPOS DE COMBUSTÍVEL ---
//   console.log('\nSeeding fuel types...');
//   const fuelTypesToSeed: Prisma.FuelTypeCreateInput[] = [
//     { name: 'Gasolina Comum' },
//     { name: 'Gasolina Aditivada' },
//     { name: 'Etanol' },
//     { name: 'Diesel S10' },
//     { name: 'Diesel S500' },
//     { name: 'GNV' }, // Gás Natural Veicular
//     // Adicione outros tipos se necessário
//     // { name: 'Elétrico' }, // Se aplicável no futuro
//     // { name: 'Outro' },
//   ];

//   for (const ftData of fuelTypesToSeed) {
//     const fuelType = await prisma.fuelType.upsert({
//       where: { name: ftData.name }, // Procura pelo nome único
//       update: {}, // Não há nada específico para atualizar se já existir
//       create: { // Dados para criar se não existir
//         name: ftData.name,
//       },
//     });
//     console.log(`Created/Updated fuel type: ${fuelType.name} (ID: ${fuelType.id})`);
//   }
//   // --- FIM DA SEÇÃO DE TIPOS DE COMBUSTÍVEL ---

//   const expenseCategories = [
//     { name: 'Manutenção Programada', iconName: 'wrench' },
//     { name: 'Manutenção Corretiva', iconName: 'exclamation-triangle' },
//     { name: 'IPVA', iconName: 'file-text-o' },
//     { name: 'Seguro', iconName: 'shield' },
//     { name: 'Multa', iconName: 'ticket' },
//     { name: 'Lavagem / Estética', iconName: 'car' }, // Ícone 'bath' ou 'shower' podem ser opções
//     { name: 'Estacionamento', iconName: 'product-hunt' }, // Ou 'local-parking' (MaterialIconNames)
//     { name: 'Pedágio', iconName: 'road' },
//     { name: 'Acessórios / Peças', iconName: 'cart-plus' },
//     { name: 'Documentação', iconName: 'id-card-o' },
//     { name: 'Outros', iconName: 'asterisk' }, // Categoria genérica
//   ];

//   for (const cat of expenseCategories) {
//     await prisma.expenseCategory.upsert({
//       where: { name: cat.name },
//       update: { iconName: cat.iconName },
//       create: cat
//     })
//     console.log(`Created/Updated expense category: ${cat.name}`);
//   }

//   // --- Adicione também algumas categorias iniciais no seed ---
//   console.log('\nSeeding vehicle categories...');
//   const vehicleCategories = [
//     { name: 'Carro', iconName: 'car' },
//     { name: 'Moto', iconName: 'motorcycle' },
//     { name: 'Caminhonete / SUV', iconName: 'truck' },
//     { name: 'Van / Utilitário', iconName: 'bus' },
//     { name: 'Caminhão', iconName: 'truck' },
//     { name: 'Ônibus', iconName: 'bus' },
//   ];

//   for (const cat of vehicleCategories) {
//     await prisma.vehicleCategory.upsert({
//       where: { name: cat.name },
//       update: { iconName: cat.iconName },
//       create: cat,
//     });
//     console.log(`Created/Updated vehicle category: ${cat.name}`);
//   }

//   console.log('\nSeeding note reminder types...');
//   const noteTypes = [
//     { name: 'Nota', iconName: 'sticky-note-o' },
//     { name: 'Problema', iconName: 'exclamation-triangle' },
//     { name: 'Acidente/Incidente', iconName: 'car' },
//     { name: 'Lembrete', iconName: 'calendar-plus-o' },
//   ];

//   for (const nt of noteTypes) {
//     await prisma.noteReminderType.upsert({
//       where: { name: nt.name },
//       update: { iconName: nt.iconName, },
//       create: nt,
//     });
//     console.log(`Created/Updated vehicle category: ${nt.name}`);
//   }

//   console.log(`Seeding finished.`);
// }

// main()
//   .catch((e) => {
//     console.error(e);
//     process.exit(1);
//   })
//   .finally(async () => {
//     await prisma.$disconnect();
//   });