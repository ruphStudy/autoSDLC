import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Architecture } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { SafeUser } from '../auth/types/auth.types';
import { ArchitectureService } from './architecture.service';
import { EditArchitectureDto } from './dto/edit-architecture.dto';
import { ArchitectureVersionSummary } from './types/architecture.types';

@UseGuards(JwtAuthGuard)
@Controller('projects/:projectId/architecture')
export class ArchitectureController {
  constructor(private readonly architectureService: ArchitectureService) {}

  @Post('generate')
  generate(
    @CurrentUser() user: SafeUser,
    @Param('projectId') projectId: string,
  ): Promise<Architecture> {
    return this.architectureService.generate(user.id, projectId);
  }

  @Post('regenerate')
  regenerate(
    @CurrentUser() user: SafeUser,
    @Param('projectId') projectId: string,
  ): Promise<Architecture> {
    return this.architectureService.regenerate(user.id, projectId);
  }

  @Get()
  getCurrent(
    @CurrentUser() user: SafeUser,
    @Param('projectId') projectId: string,
  ): Promise<Architecture> {
    return this.architectureService.getCurrent(user.id, projectId);
  }

  @Get('versions')
  listVersions(
    @CurrentUser() user: SafeUser,
    @Param('projectId') projectId: string,
  ): Promise<ArchitectureVersionSummary[]> {
    return this.architectureService.listVersions(user.id, projectId);
  }

  @Get('versions/:version')
  getVersion(
    @CurrentUser() user: SafeUser,
    @Param('projectId') projectId: string,
    @Param('version', ParseIntPipe) version: number,
  ): Promise<Architecture> {
    return this.architectureService.getVersion(user.id, projectId, version);
  }

  @Patch()
  @HttpCode(HttpStatus.OK)
  edit(
    @CurrentUser() user: SafeUser,
    @Param('projectId') projectId: string,
    @Body() dto: EditArchitectureDto,
  ): Promise<Architecture> {
    return this.architectureService.edit(user.id, projectId, dto);
  }
}
