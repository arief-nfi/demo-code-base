import { ApiProperty } from '@nestjs/swagger';

export class CreateRoleDto {
  @ApiProperty({ example: 'admin', description: 'The name of the role' })
  name: string;

  @ApiProperty({ example: 'Administrator role', description: 'The description of the role', required: false })
  description?: string;

  @ApiProperty({ example: ['uuid-1', 'uuid-2'], description: 'List of permission IDs', required: false })
  permissionIds?: string[];
}
