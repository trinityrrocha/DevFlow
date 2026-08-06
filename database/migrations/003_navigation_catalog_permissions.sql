INSERT INTO permissions (code,name,description) VALUES
    ('clients.view','Visualizar clientes','Consultar clientes vinculados à empresa'),
    ('clients.manage','Administrar clientes','Criar, editar, ativar, desativar e excluir clientes sem vínculos'),
    ('projects.view','Visualizar projetos','Consultar projetos vinculados à empresa')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (company_id,role_id,permission_id)
SELECT role.company_id,role.id,permission.id
FROM company_roles role
JOIN permissions permission ON permission.code IN (
    'clients.view','clients.manage','projects.view'
)
WHERE role.code='ADMIN'
ON CONFLICT (role_id,permission_id) DO NOTHING;

INSERT INTO role_permissions (company_id,role_id,permission_id)
SELECT role.company_id,role.id,permission.id
FROM company_roles role
JOIN permissions permission ON permission.code IN ('clients.view','projects.view')
WHERE role.code='USER'
ON CONFLICT (role_id,permission_id) DO NOTHING;
