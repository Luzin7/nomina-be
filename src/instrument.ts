import { buildSentryOptions } from '@infra/observability/sentry-options';
import * as Sentry from '@sentry/nestjs';
import 'dotenv/config';

Sentry.init(buildSentryOptions(process.env));
