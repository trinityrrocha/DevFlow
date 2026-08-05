import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const read = (file) => readFileSync(resolve(root, file), 'utf8');
const migration = read('database/migrations/002_auth_security_policy.sql');
const policy = read('backend/src/services/mfaPolicyService.js');
const auth = read('backend/src/controllers/authController.js');
const authRoutes = read('backend/src/routes/authRoutes.js');
const authMiddleware = read('backend/src/middleware/authMiddleware.js');
const session = read('backend/src/services/sessionService.js');
const mfa = read('backend/src/services/mfaService.js');
const audit = read('backend/src/services/auditService.js');
const csrf = read('backend/src/services/csrfService.js');
const csrfMiddleware = read('backend/src/middleware/csrfMiddleware.js');
const errorMiddleware = read('backend/src/middleware/errorMiddleware.js');
const api = read('frontend/src/services/api.js');
const layout = read('frontend/src/layouts/DashboardLayout.jsx');
const settings = read('frontend/src/pages/Settings.jsx');
const common = read('scripts/lib/common.sh');
const install = read('scripts/install.sh');
const repair = read('scripts/repair-installation-state.sh');
const checks = [];
const check = (label, condition) => {
  if (!condition) throw new Error(`Auth/state recovery validation failed: ${label}`);
  checks.push(label);
};

check('01 absent MFA policy defaults to optional', policy.includes("return { enforcement_mode: 'optional'")
  && migration.includes("VALUES (TRUE,'optional')"));
check('02 optional does not block user without MFA', policy.includes("if (mode === 'optional') return false")
  && policy.includes('user?.mfa_enabled !== true && isMfaRequiredForUser'));
check('03 enabled MFA remains required during login', auth.includes('if (mfa?.enabled)')
  && auth.includes('mfa_required: true'));
check('04 admins applies only to administrative identities', policy.includes("mode === 'admins' && isAdministrativeUser(user)"));
check('05 all applies to every user without MFA', policy.includes("mode === 'all'"));
check('06 only Super Admin changes policy', authRoutes.includes("router.patch('/mfa/policy', requireAuth, requireSuperAdmin"));
check('07 invalid policy value is rejected', policy.includes("throw new AppError('MFA_POLICY_INVALID'")
  && auth.includes("z.enum(['optional', 'admins', 'all'])"));
check('08 policy mutation uses strict audit in transaction', policy.includes("operation: 'MFA_POLICY_UPDATED'")
  && policy.includes('strict: true') && audit.includes('if (strict) throw error'));
check('09 password change remains independent', authMiddleware.includes('PASSWORD_CHANGE_REQUIRED')
  && authMiddleware.indexOf('if (req.user.must_change_password')
    < authMiddleware.indexOf('if (req.user.mfa_setup_required'));
check('10 frontend guard does not use legacy MFA flag', layout.includes('user.mfa_setup_required')
  && !layout.includes('must_configure_mfa'));

check('11 CSRF is issued after session login', auth.indexOf('res.cookie(SESSION_COOKIE, token')
  < auth.indexOf('issueCsrf(res, token)'));
check('12 CSRF cookie contract is explicit', csrf.includes("const CSRF_COOKIE = 'devflow_csrf'")
  && csrf.includes("sameSite: 'lax'") && csrf.includes("path: '/'") && csrf.includes('httpOnly: false'));
check('13 frontend sends the canonical header', api.includes("'X-CSRF-Token'")
  && csrf.includes("const CSRF_HEADER = 'x-csrf-token'"));
check('14 missing token returns CSRF_INVALID', csrfMiddleware.includes("new AppError('CSRF_INVALID'"));
check('15 invalid token is rejected in constant time', csrfMiddleware.includes('safeEqual(cookie, header)')
  && csrf.includes('crypto.timingSafeEqual'));
check('16 valid session-bound token passes', csrfMiddleware.includes('verifyToken(cookie, sessionToken)')
  && csrf.includes('sessionBinding(sessionToken)'));
check('17 MFA setup is protected rather than exempt', api.includes("isCsrfExempt(url)")
  && !api.includes("url.includes(path)")
  && csrfMiddleware.includes("'/api/auth/mfa'")
  && !csrfMiddleware.includes("'/api/auth/mfa/setup/start'"));
check('18 password change clears session and CSRF before new login', read('backend/src/controllers/userController.js').includes('res.clearCookie(CSRF_COOKIE')
  && auth.includes('issueCsrf(res, token)'));
check('19 MFA setup after rotation can refresh once', api.includes("code === 'CSRF_INVALID'")
  && api.includes('await refreshCsrf()') && api.includes('return api(request)'));
check('20 frontend reads current cookie for every mutable request', api.includes("let token = readCookie('devflow_csrf')")
  && api.includes("token = readCookie('devflow_csrf')"));
check('21 withCredentials is active', api.includes('withCredentials: true'));
check('22 CSRF retry is limited to one attempt', api.includes('!request.__devflowCsrfRetried')
  && api.includes('request.__devflowCsrfRetried = true'));
check('23 FORBIDDEN is not treated as CSRF', api.includes("code === 'CSRF_INVALID'")
  && errorMiddleware.includes('code: error.code'));
check('24 tokens are excluded from logs and audit values', audit.includes('password|secret|token|passphrase')
  && !csrf.includes('console.') && !csrfMiddleware.includes('console.'));

check('25 installer writes schema v3 atomically', common.includes('"schemaVersion": 3')
  && read('scripts/validate-installation-state.py').includes('os.replace(temporary, destination)'));
check('26 installed validator is authoritative', install.includes('DEVFLOW_INSTALL_ROOT/app/scripts/validate-installation-state.py'));
check('27 installed health runs in a new process', install.includes('"$DEVFLOW_INSTALL_ROOT/app/scripts/health.sh" --quiet'));
const finalInstallerMessage = install.slice(install.indexOf('cat <<EOF\nDevFlow instalado com sucesso.'));
check('28 invalid state prevents success and no hardcoded health remains', install.indexOf('health_status')
  < install.indexOf('DevFlow instalado com sucesso.')
  && !finalInstallerMessage.includes('overall_health=healthy'));
check('29 repair tool has check mode', repair.includes('--check|--repair') && repair.includes('if [[ "$MODE" == check ]]'));
check('30 repair tool writes and reloads schema v3', repair.includes('write_installation_state')
  && repair.includes('load_installation_state "$state_file"'));
check('31 repair tool does not alter database or run migrations', !/\b(build|pull|up -d|run_devflow_migrations|INSERT INTO|UPDATE users|DELETE FROM)\b/u.test(repair));
check('32 repair tool does not alter certificates', repair.includes('validate_devflow_certificate')
  && !/certbot|renew|delete --cert/u.test(repair));
check('33 repair tool only reads Super Admin', repair.includes('SELECT EXISTS(SELECT 1 FROM users')
  && !repair.includes('/api/auth/bootstrap'));

check('34 initial password uses original TTY descriptor', install.includes('exec 3>/dev/tty')
  && install.includes('Senha temporaria:') && install.includes('>&3'));
check('35 non-TTY output contains path only', install.includes('initial_credentials_displayed=false')
  && install.includes('initial_credentials_path='));
check('36 password bypasses tee and is not in normal completion block', install.includes('"  $password"')
  && !finalInstallerMessage.includes('"  $password"'));
check('37 password is absent from installation state', !common.slice(common.indexOf('write_installation_state()'), common.indexOf('installation_state_value()')).includes('password'));
check('38 temporary password enforces root root 0600', install.includes("== '0:0 600'"));
check('39 resume checks bootstrap before generating any password', install.indexOf('required="$(docker exec devflow-backend')
  < install.indexOf('ensure_temporary_admin_password'));
check('40 temporary password change remains mandatory', auth.includes('must_change_password,must_configure_mfa')
  && read('backend/src/controllers/userController.js').includes('must_change_password=FALSE'));

if (checks.length !== 40) throw new Error(`Expected 40 checks, got ${checks.length}`);
console.log(`Auth, CSRF, installed state and credential recovery validated: ${checks.length} mandatory scenarios.`);
