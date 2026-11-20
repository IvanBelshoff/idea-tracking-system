import { LOGIN_DEFAULT, type LoginScreenConfig } from './login-screen-rules.js';

/**
 * Registro das configurações da instalação (§16 das regras), com valor padrão e tipo.
 * O banco (`setting`) guarda só o que foi alterado; o resto vem daqui.
 */
/** Fontes oferecidas na identidade visual: Geist (padrão do ITS) e três alternativas. */
export const BRAND_FONTS = ['geist', 'inter', 'atkinson', 'plex'] as const;
export type BrandFont = (typeof BRAND_FONTS)[number];

export const SETTING_DEFAULTS = {
  /** Nome exibido da organização; definido no assistente de instalação. */
  'organization.name': '',
  /** Fuso da instalação (regras de prazo, CA-T.3). */
  'organization.timezone': 'America/Sao_Paulo',
  'organization.default_locale': 'pt-BR',
  /** Onde fica a ajuda (documentação): o serviço "docs", no mesmo endereço, por padrão. */
  'help.docs_url': '/ajuda/',
  /** Preenchido ao concluir o assistente (RN-43). Enquanto nulo, só o assistente responde. */
  'installation.completed_at': null as string | null,

  // Ideias (M2)
  /** Prefixo do identificador (RN-22). Mudar só afeta as próximas ideias (CA-RN-22.4). */
  'ideas.code_prefix': 'ITS',
  /** Categoria principal obrigatória no envio (RN-03, CA-RN-03.2). */
  'ideas.category_required': true,
  /** Atalho da D3: o analista pode aprovar direto de "Enviada" (assumir + aprovar). */
  'ideas.triage_shortcut': true,
  /**
   * Sugestões de ideias parecidas no envio (RN-57): além das que a pessoa já vê, mostrar o TÍTULO das
   * ideias abertas da entidade onde ela está enviando, para poder apoiar em vez de duplicar.
   */
  'ideas.similar_show_titles': true,
  /** Prazo de retorno da triagem, em dias (RN-54): Enviada além disso fica atrasada e alerta a equipe. */
  'triage.sla_days': 10,
  /** Contar o prazo de triagem em dias úteis (sábado e domingo não contam; CA-RN-54.3). */
  'triage.business_days': false,
  /** Moeda dos ganhos financeiros (RN-62), código ISO 4217. */
  'results.currency': 'BRL',
  /** Revisão de sustentação N dias depois de implementar (RN-65). 0 = desligada. */
  'results.sustainment_days': 0,
  /** Reconhecimento (RN-66 a RN-71): desligado por padrão; a organização decide se quer. */
  'recognition.enabled': false,
  /** Pesos por evento (RN-66). Mudar vale daqui para frente; o passado não é recalculado. */
  'recognition.points_submitted': 10,
  'recognition.points_approved': 20,
  'recognition.points_implemented': 50,
  'recognition.points_highlighted': 30,
  /** Parte do autor quando há co-autores, em % (RN-89); o resto é dividido entre eles. */
  'recognition.author_share': 50,
  /** Co-autor por convergência ganha pontos e aparece no Hall (RN-89, CA-RN-89.2). */
  'recognition.converged_coauthorship': true,
  /** Ranking individual; desligado, só o ranking por entidade (RN-70, CA-RN-70.2). */
  'recognition.individual_ranking': true,
  /** Hall (RN-72 a RN-80). Curtidas medem interesse e podem ser desligadas (RN-76). */
  'hall.likes_enabled': true,
  /** Mostrar o ganho validado no cartão do Hall (RN-75). */
  'hall.show_gain': false,
  /** Permitir destacar ideias Em andamento, além das Implementadas (RN-73). */
  'hall.allow_in_progress': false,
  /** Entrada automática das candidatas, sem curadoria (RN-72). Desligada por padrão. */
  'hall.auto_entry': false,
  /** Critérios das candidatas automáticas: ganho validado por ano e curtidas (0 = critério desligado). */
  'hall.suggest_min_gain': 0,
  'hall.suggest_min_likes': 5,
  /** Mural de ideias (M21, RN-148): desligado de fábrica; ligado, o Início vira o mural. */
  'mural.enabled': false,
  /** Loja (M22, RN-159): desligada de fábrica e só liga com o reconhecimento ligado. */
  'store.enabled': false,
  /** Validade do saldo em meses (RN-162); 0 = não expira. */
  'store.expiry_months': 0,
  /** Quando a loja foi ligada pela primeira vez (RN-161): marca o saldo inicial. Não é editável. */
  'store.initialized_at': null as string | null,
  /** Aprovação de outras áreas (M24, RN-188): uma recusa devolve a decisão ao analista ou bloqueia. */
  'approval.on_reject': 'return' as 'return' | 'block',
  /** Código de 6 dígitos por e-mail na página do link (RN-185); desligado de fábrica. */
  'approval.email_code': false,
  /** Aceitar aprovador com e-mail fora dos domínios da empresa (RN-190); com domínios, a tela avisa. */
  'approval.allow_outside_domains': true,
  /** Prazo de fábrica para responder, em dias (RN-183). */
  'approval.default_days': 14,
  /** Identidade visual: cor da marca (#RRGGBB). Nulo = índigo do ITS. O escuro é derivado dela. */
  'branding.color': null as string | null,
  /** Tom escolhido para o tema escuro (opcional; corrigido se não for legível). Nulo = derivado. */
  'branding.color_dark': null as string | null,
  /** Fonte da interface inteira (os códigos continuam em Geist Mono). */
  'branding.font': 'geist' as BrandFont,
  /** Cada pessoa pode escolher a cor (da paleta curada) e a fonte da própria tela (RN-145). */
  'branding.user_theme': false,
  /**
   * Tela de login (M23, RN-176 a RN-180): layout, fundo, ajustes e textos, num objeto só. Fora das
   * configurações editáveis em bloco: só a API da tela de login grava (confere os arquivos e audita).
   */
  'branding.login': LOGIN_DEFAULT as LoginScreenConfig,
  /** Progresso por etapas concluídas ou por tempo decorrido (RN-19). */
  'steps.progress_mode': 'steps' as 'steps' | 'time',
  /** Anexos (RN-21): tamanho máximo e extensões permitidas. Valem na requisição seguinte. */
  'attachments.max_mb': 10,
  'attachments.allowed_extensions': [
    'pdf',
    'png',
    'jpg',
    'jpeg',
    'webp',
    'gif',
    'txt',
    'csv',
    'xlsx',
    'xls',
    'docx',
    'doc',
    'pptx',
    'odt',
    'ods',
    'zip',
    // Vídeo abre na tela (RN-147); o tamanho máximo continua o do administrador.
    'mp4',
    'webm',
  ] as string[],

  // Foto do perfil (RN-91): tamanho máximo do arquivo enviado, em MB.
  'profile.photo_max_mb': 2,

  // Consulta pública (M5, RN-33): desligada por padrão; o administrador liga.
  'public.lookup_enabled': false,

  // Notificações e e-mail (M4)
  /** Alerta de prazo: quantos dias antes do vencimento (RN-29); cada pessoa pode pedir menos. */
  'notifications.deadline_alert_days': 3,
  /** Horário do resumo diário por e-mail (RN-31), no fuso da instalação. */
  'email.digest_time': '07:00',
  /** Endereço do sistema, para os links dos e-mails. Obrigatório para ligar o envio. */
  'email.app_url': '',

  // Senhas e login (RN-42)
  'auth.password_min_length': 10,
  /** Quantas classes de caractere (minúscula, maiúscula, dígito, símbolo) são exigidas. */
  'auth.password_min_classes': 3,
  'auth.max_failed_attempts': 5,
  'auth.lockout_minutes': 15,
  'auth.session_hours': 12,
  /** Sessão de quem entra pelo login corporativo: mais curta, para a pessoa voltar ao provedor todo dia (RN-96). */
  'auth.sso_session_hours': 8,
  'auth.reset_link_minutes': 60,

  // Acesso corporativo (M13, RN-95 a RN-98). Fora das configurações editáveis em bloco: só a API de
  // acesso corporativo altera, porque valida pré-condições (teste de conexão, domínio, vínculo).
  /** Como se entra: só senha (de fábrica), senha ou SSO, ou só SSO. */
  'auth.login_mode': 'password' as 'password' | 'password_sso' | 'sso',
  /** Domínios de e-mail da empresa; lista vazia = sem restrição (RN-95). */
  'auth.email_domains': [] as string[],
  /** Aceita cadastrar e-mail fora dos domínios. */
  'auth.allow_external_email': false,
  /** Cria a conta no primeiro login corporativo (RN-98). */
  'sso.auto_create': false,
  /** Perfil e entidade da conta criada automaticamente; nulos até o administrador configurar. */
  'sso.default_role_id': null as string | null,
  'sso.default_entity_id': null as string | null,

  // Integrações (M16, RN-102). Fora das configurações editáveis em bloco: só a API de integrações
  // altera, porque valida pré-condições (endereço em HTTPS) e audita.
  /** Chave geral da API de integração (`/integration/v1`); desligada de fábrica. */
  'integration.enabled': false,
  /** Módulos ligados (`ideas`, `indicators`, `campaigns`, `hall`, `entities`, `users`); nenhum de fábrica. */
  'integration.modules': [] as string[],
  /** Chave dos webhooks de saída (M17, RN-117); desligada de fábrica. Exige a chave geral. */
  'integration.webhooks_enabled': false,
  /** Destinos permitidos dos webhooks: nomes, domínios com curinga, IPs e faixas (até 50). */
  'integration.webhook_destinations': [] as string[],

  // Observabilidade (M12, RN-92)
  /** Quantos dias de histórico por hora a observabilidade guarda; o worker apaga o que passa disso. */
  'ops.retention_days': 30,
};

export type SettingKey = keyof typeof SETTING_DEFAULTS;
export type SettingValue<K extends SettingKey> = (typeof SETTING_DEFAULTS)[K];
