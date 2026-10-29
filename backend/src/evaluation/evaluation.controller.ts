import { Body, Controller, Get, Header, Param, Post } from '@nestjs/common';
import { EvaluationService } from './evaluation.service';
import { RunEvaluationDto } from './run-evaluation.dto';

@Controller('evaluations')
export class EvaluationController {
  constructor(private readonly evaluations: EvaluationService) {}

  @Post('run')
  run(@Body() request: RunEvaluationDto) {
    return this.evaluations.run(request);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.evaluations.get(id);
  }

  @Get(':id/report')
  @Header(
    'Content-Disposition',
    'attachment; filename="evaluation-report.json"',
  )
  report(@Param('id') id: string) {
    return this.evaluations.report(id);
  }

  @Post(':id/cancel')
  cancel(@Param('id') id: string) {
    return this.evaluations.cancel(id);
  }
}
