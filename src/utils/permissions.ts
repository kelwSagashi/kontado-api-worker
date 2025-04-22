export default {
    user: {
        read: 'user:read:me',
        update: 'user:update:me',
        delete: 'user:delete:me',
        change_password: 'user:change_password:me',
        any: 'user:common:any',
    },
    note: {
        create: 'note:create:own',
        read: 'note:read:own',
        update: 'note:update:own',
        delete: 'note:delete:own',
    },
    todo: {
        manage: 'todo:manage:own'
    },
    vehicle: {
        create: 'vehicle:create',
        read: 'vehicle:read:own',
        update: 'vehicle:update:own',
        delete: 'vehicle:delete:own',
    },
    station: {
        create: 'station:propose:create',
        update: 'station:propose:update',
        read: 'station:read:any',
    },
    price: {
        update: 'price:propose:update',
        read: 'price:read:any',
    },
    review: {
        review: 'proposal:review',
        read_pending: 'proposal:read:pending',
        read_details: 'proposal:read:details',
    },
    expense: {
        create: 'expense:create',
        read: 'expense:read:own',
        update: 'expense:update:own',
        delete: 'expense:delete:own',
    },
    feature: {
        advanced_report: 'feature:access:advanced_reports',
        price_comparison: 'feature:access:price_comparison',
        authorize: 'vehicle:authorize:own'
    },
    admin: {
        read: 'admin:user:read:any',
        create: 'admin:user:create:any',
        update: 'admin:user:update:any',
        delete: 'admin:user:delete:any',
        read_any: 'admin:user:read:any',
        create_any: 'admin:create:any',
        update_any: 'admin:update:any',
        delete_any: 'admin:delete:any',
        assign: 'admin:role:assign',
        permission_manage: 'admin:permission:manage',
        porposal_manage: 'admin:proposal:manage',
    },
    budget: {
        create: 'budget:create', 
        read: 'budget:read:own', 
        update: 'budget:update:own',
        delete: 'budget:delete:own',
    }

} as const ;
