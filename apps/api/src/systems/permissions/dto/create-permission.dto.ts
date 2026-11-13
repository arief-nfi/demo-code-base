import { ApiProperty } from '@nestjs/swagger';

export class CreatePermissionDto {
  @ApiProperty({ example: 'users:read', description: 'The name of the permission' })
  name: string;

  @ApiProperty({ example: 'Allows reading users', description: 'The description of the permission', required: false })
  description?: string;
}
