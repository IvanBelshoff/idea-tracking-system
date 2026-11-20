import { ApiProperty } from '@nestjs/swagger';
import { z } from 'zod';
import { ALL_PERMISSIONS, type Permission } from './permissions.js';

const permissionList = z
  .array(z.enum(ALL_PERMISSIONS as [Permission, ...Permission[]]))
  .max(ALL_PERMISSIONS.length)
  .transform((list) => [...new Set(list)]);

export const CreateRoleSchema = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(500).nullable().optional(),
  permissions: permissionList,
});

export const UpdateRoleSchema = CreateRoleSchema.partial().refine(
  (v) => Object.keys(v).length > 0,
  'Informe ao menos um campo',
);

export class PermissionInfo {
  @ApiProperty({ enum: ALL_PERMISSIONS, enumName: 'Permission' }) code!: Permission;
  @ApiProperty({ description: 'Descrição em pt-BR (o frontend traduz pelo código)' }) description!: string;
}

export class RoleView {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ type: String, nullable: true }) description!: string | null;
  @ApiProperty({ description: 'Perfil de fábrica: não pode ser apagado' }) isSystem!: boolean;
  @ApiProperty({ type: String, nullable: true, example: 'analyst' }) systemKey!: string | null;
  @ApiProperty({ enum: ALL_PERMISSIONS, enumName: 'Permission', isArray: true }) permissions!: Permission[];
  @ApiProperty({ description: 'Quantos usuários têm este perfil' }) usersCount!: number;
}

export class CreateRoleRequest {
  @ApiProperty({ example: 'Comitê de melhoria' }) name!: string;
  @ApiProperty({ type: String, required: false, nullable: true }) description?: string | null;
  @ApiProperty({ enum: ALL_PERMISSIONS, enumName: 'Permission', isArray: true }) permissions!: Permission[];
}

export class UpdateRoleRequest {
  @ApiProperty({ required: false }) name?: string;
  @ApiProperty({ type: String, required: false, nullable: true }) description?: string | null;
  @ApiProperty({ enum: ALL_PERMISSIONS, enumName: 'Permission', isArray: true, required: false })
  permissions?: Permission[];
}
