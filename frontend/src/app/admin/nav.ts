import {
  Activity,
  Building2,
  KeyRound,
  Mail,
  Palette,
  Plug,
  ScrollText,
  Settings,
  ShieldCheck,
  Tags,
  Trophy,
  UserCheck,
  UserCog,
  Users,
} from 'lucide-react';
import { registerAdminNav } from '../shell/app-shell';

/** Itens da administração no menu, cada um visível só para quem tem a permissão da tela. */
registerAdminNav((t) => [
  { to: '/admin/usuarios', label: t('admin.nav.users'), Icon: Users, anyOf: ['user.manage'] },
  { to: '/admin/campos-do-usuario', label: t('admin.nav.userFields'), Icon: UserCog, anyOf: ['user.manage'] },
  { to: '/admin/perfis', label: t('admin.nav.roles'), Icon: ShieldCheck, anyOf: ['role.manage'] },
  { to: '/admin/entidades', label: t('admin.nav.entities'), Icon: Building2, anyOf: ['entity.manage'] },
  { to: '/admin/categorias', label: t('admin.nav.categories'), Icon: Tags, anyOf: ['category.manage'] },
  { to: '/admin/configuracoes', label: t('admin.nav.settings'), Icon: Settings, anyOf: ['setting.manage'] },
  { to: '/admin/identidade', label: t('admin.nav.branding'), Icon: Palette, anyOf: ['setting.manage'] },
  { to: '/admin/atribuicao', label: t('admin.nav.triageRules'), Icon: UserCheck, anyOf: ['setting.manage'] },
  { to: '/admin/reconhecimento', label: t('admin.nav.recognition'), Icon: Trophy, anyOf: ['setting.manage'] },
  { to: '/admin/email', label: t('admin.nav.email'), Icon: Mail, anyOf: ['email.manage'] },
  { to: '/admin/acesso', label: t('admin.nav.access'), Icon: KeyRound, anyOf: ['sso.manage'] },
  {
    to: '/admin/integracoes',
    label: t('admin.nav.integrations'),
    Icon: Plug,
    anyOf: ['integration.manage'],
  },
  { to: '/admin/auditoria', label: t('admin.nav.audit'), Icon: ScrollText, anyOf: ['audit.view'] },
  { to: '/admin/observabilidade', label: t('admin.nav.ops'), Icon: Activity, anyOf: ['ops.view'] },
]);
