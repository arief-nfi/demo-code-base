import { ApiProperty } from '@nestjs/swagger';

export class UpdatePermissionDto {
  @ApiProperty({ example: 'users:read', description: 'The name of the permission', required: false })
  name?: string;

  @ApiProperty({ example: 'Allows reading users', description: 'The description of the permission', required: false })
  description?: string;
}
