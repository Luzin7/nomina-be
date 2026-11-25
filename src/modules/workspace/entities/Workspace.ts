import { DEFAULT_WORKSPACE_CYCLE, type WorkspaceCycle } from '@constants/enums';
import { AggregateRoot } from '@shared/core/Entities/AggregateRoot';
import { Either, left, right } from '@shared/core/errors/Either';
import { Optional } from '@shared/core/types/Optional';

export interface WorkspaceProps {
  name: string;
  currency: string;
  timezone: string;
  cycle: WorkspaceCycle;
  createdAt: Date;
}

export class Workspace extends AggregateRoot<WorkspaceProps> {
  private constructor(props: WorkspaceProps, id?: string) {
    super(props, id);
  }

  static create(
    props: Optional<
      WorkspaceProps,
      'createdAt' | 'currency' | 'timezone' | 'cycle'
    >,
    id?: string,
  ): Either<Error, Workspace> {
    if (!props.name || props.name.trim().length < 2) {
      return left(
        new Error('O nome do workspace deve ter no mínimo 2 caracteres.'),
      );
    }

    const workspaceProps: WorkspaceProps = {
      ...props,
      createdAt: props.createdAt ?? new Date(),
      currency: props.currency ?? 'BRL',
      timezone: props.timezone ?? 'America/Sao_Paulo',
      cycle: props.cycle ?? DEFAULT_WORKSPACE_CYCLE,
    };

    return right(new Workspace(workspaceProps, id));
  }

  get name(): string {
    return this.props.name;
  }

  get currency(): string {
    return this.props.currency;
  }

  get timezone(): string {
    return this.props.timezone;
  }

  get cycle(): WorkspaceCycle {
    return this.props.cycle;
  }

  get createdAt(): Date {
    return this.props.createdAt;
  }

  public updateDetails(
    name: string,
    currency: string,
    timezone: string,
    cycle: WorkspaceCycle = this.props.cycle,
  ): Either<Error, void> {
    if (!name || name.trim().length < 2) {
      return left(
        new Error('O nome do workspace deve ter no mínimo 2 caracteres.'),
      );
    }

    this.props.name = name;
    this.props.currency = currency;
    this.props.timezone = timezone;
    this.props.cycle = cycle;
    return right(undefined);
  }
}
