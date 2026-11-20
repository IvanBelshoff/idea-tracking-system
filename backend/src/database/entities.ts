import {
  ApprovalEvidence,
  ApprovalRecipient,
  ApprovalRequest,
  ApprovalRequestAttachment,
} from '../approvals/entities.js';
import { AuditLog } from '../audit/audit-log.entity.js';
import { Campaign, CampaignCategory, CampaignEntity } from '../campaigns/entities.js';
import {
  AlertDedup,
  EmailLog,
  EmailTemplate,
  MailProvider,
  Notification,
  NotificationPreference,
} from '../communication/entities.js';
import { HallDismissal, Highlight, HighlightConsent, HighlightPraise, IdeaLike } from '../hall/entities.js';
import { Attachment } from '../ideas/entities/attachment.entity.js';
import { Idea, IdeaCategory, IdeaSequence } from '../ideas/entities/idea.entity.js';
import { Comment, IdeaEvent, IdeaParticipant, Step } from '../ideas/entities/idea-related.entity.js';
import { FinancialGain, Measurement, SustainmentReview } from '../ideas/entities/result.entity.js';
import { SavedFilter } from '../ideas/entities/saved-filter.entity.js';
import { TriageRule } from '../ideas/entities/triage-rule.entity.js';
import { PasswordReset } from '../identity-access/entities/password-reset.entity.js';
import { Role, RolePermission } from '../identity-access/entities/role.entity.js';
import { Session } from '../identity-access/entities/session.entity.js';
import { SsoProvider } from '../identity-access/entities/sso-provider.entity.js';
import { User } from '../identity-access/entities/user.entity.js';
import { UserAvatar } from '../identity-access/entities/user-avatar.entity.js';
import { UserIdentity } from '../identity-access/entities/user-identity.entity.js';
import { UserRoleScope } from '../identity-access/entities/user-role-scope.entity.js';
import {
  Integration,
  IntegrationHour,
  IntegrationIdempotency,
  IntegrationScope,
  IntegrationToken,
} from '../integration/entities.js';
import { WebhookDelivery, WebhookEvent, WebhookSecret, WebhookSubscription } from '../integration/webhooks/entities.js';
import {
  MuralComment,
  MuralCommentRevision,
  MuralConsent,
  MuralPost,
  MuralReactionRow,
  MuralReport,
  MuralShare,
} from '../mural/entities.js';
import { OpsAlertState, OpsHeartbeat, OpsMetricHour } from '../observability/entities.js';
import { Category } from '../organization/entities/category.entity.js';
import { LoginMedia } from '../organization/entities/login-media.entity.js';
import { OrgEntity } from '../organization/entities/org-entity.entity.js';
import { OrganizationLogo } from '../organization/entities/organization-logo.entity.js';
import { Setting } from '../organization/entities/setting.entity.js';
import { Achievement, Level, PointLedger, RewardRecord, Season, UserAchievement } from '../recognition/entities.js';
import { StoreExpiryNotice, StoreItem, StoreItemEntity, StoreLedger, StoreOrder } from '../store/entities.js';
import { IdeaFieldValue, UserField, UserFieldOption, UserFieldValue } from '../user-fields/entities.js';

/**
 * Lista explícita (sem glob): funciona igual no código compilado, nos testes e no gerador de
 * migrações. Toda entidade nova entra aqui.
 */
export const ENTITIES = [
  User,
  Session,
  PasswordReset,
  SsoProvider,
  UserIdentity,
  Role,
  RolePermission,
  UserRoleScope,
  OrgEntity,
  Category,
  Setting,
  AuditLog,
  Idea,
  IdeaCategory,
  IdeaSequence,
  IdeaParticipant,
  Step,
  Comment,
  IdeaEvent,
  Attachment,
  Notification,
  NotificationPreference,
  AlertDedup,
  MailProvider,
  EmailTemplate,
  EmailLog,
  UserAvatar,
  TriageRule,
  SavedFilter,
  Measurement,
  FinancialGain,
  SustainmentReview,
  Campaign,
  CampaignEntity,
  CampaignCategory,
  Season,
  PointLedger,
  Level,
  Achievement,
  UserAchievement,
  RewardRecord,
  Highlight,
  HighlightConsent,
  HighlightPraise,
  IdeaLike,
  HallDismissal,
  OrganizationLogo,
  LoginMedia,
  OpsHeartbeat,
  OpsMetricHour,
  OpsAlertState,
  Integration,
  IntegrationScope,
  IntegrationToken,
  IntegrationHour,
  IntegrationIdempotency,
  WebhookSubscription,
  WebhookSecret,
  WebhookEvent,
  WebhookDelivery,
  MuralPost,
  MuralConsent,
  MuralReactionRow,
  MuralComment,
  MuralCommentRevision,
  MuralReport,
  MuralShare,
  StoreItem,
  StoreItemEntity,
  StoreOrder,
  StoreLedger,
  StoreExpiryNotice,
  ApprovalRequest,
  ApprovalRecipient,
  ApprovalRequestAttachment,
  ApprovalEvidence,
  UserField,
  UserFieldOption,
  UserFieldValue,
  IdeaFieldValue,
];
