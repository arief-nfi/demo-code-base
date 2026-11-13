import { ApiProperty } from '@nestjs/swagger';

export class UserQueryDto {
  @ApiProperty({ example: 1, description: 'Page number', required: false })
  page?: number;

  @ApiProperty({ example: 10, description: 'Items per page', required: false })
  limit?: number;

  @ApiProperty({ example: 'john', description: 'Search term', required: false })
  search?: string;

  @ApiProperty({ example: 'createdAt', description: 'Sort field', required: false })
  sortBy?: string;

  @ApiProperty({ example: 'asc', description: 'Sort order', enum: ['asc', 'desc'], required: false })
  sortOrder?: 'asc' | 'desc';
}
