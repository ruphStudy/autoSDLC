import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Project } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { SafeUser } from '../auth/types/auth.types';
import { ProjectsService } from './projects.service';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { ListProjectsQueryDto } from './dto/list-projects-query.dto';
import { ArchivedFilter } from './types/project.types';

@UseGuards(JwtAuthGuard)
@Controller('projects')
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  @Post()
  create(
    @CurrentUser() user: SafeUser,
    @Body() dto: CreateProjectDto,
  ): Promise<Project> {
    return this.projectsService.create(user.id, dto);
  }

  @Get()
  findAll(
    @CurrentUser() user: SafeUser,
    @Query() query: ListProjectsQueryDto,
  ): Promise<Project[]> {
    const archived: ArchivedFilter =
      query.archived === 'true'
        ? 'archived'
        : query.archived === 'all'
          ? 'all'
          : 'active';
    return this.projectsService.findAllForUser(user.id, archived);
  }

  @Get(':id')
  findOne(
    @CurrentUser() user: SafeUser,
    @Param('id') id: string,
  ): Promise<Project> {
    return this.projectsService.findOneForUser(user.id, id);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: SafeUser,
    @Param('id') id: string,
    @Body() dto: UpdateProjectDto,
  ): Promise<Project> {
    return this.projectsService.update(user.id, id, dto);
  }

  @Post(':id/archive')
  @HttpCode(HttpStatus.OK)
  archive(
    @CurrentUser() user: SafeUser,
    @Param('id') id: string,
  ): Promise<Project> {
    return this.projectsService.archive(user.id, id);
  }

  @Post(':id/restore')
  @HttpCode(HttpStatus.OK)
  restore(
    @CurrentUser() user: SafeUser,
    @Param('id') id: string,
  ): Promise<Project> {
    return this.projectsService.restore(user.id, id);
  }

  @Delete(':id')
  remove(
    @CurrentUser() user: SafeUser,
    @Param('id') id: string,
  ): Promise<{ success: true }> {
    return this.projectsService.remove(user.id, id);
  }
}
