import { ApiProperty } from '@nestjs/swagger';

export class CreateUserDto {
  @ApiProperty({ example: 'john.doe@example.com', description: 'The email of the user' })
  email: string;

  @ApiProperty({ example: 'johndoe', description: 'The username of the user' })
  username: string;

  @ApiProperty({ example: 'password123', description: 'The password of the user' })
  password: string;

  @ApiProperty({ example: 'John Doe', description: 'The name of the user' })
  name: string;

  @ApiProperty({ example: 'ACTIVE', description: 'The status of the user', enum: ['ACTIVE', 'INACTIVE'], required: false })
  status?: 'ACTIVE' | 'INACTIVE';

  @ApiProperty({ example: ['role-uuid-1', 'role-uuid-2'], description: 'List of role IDs', required: false })
  roleIds?: string[];
}
