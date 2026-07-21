import { RobotAdapterError } from './AdapterErrors';
import { JiangzhiAdapter } from './JiangzhiAdapter';
import type { RobotAdapter } from './RobotAdapter';
import type {
  AdapterMetric,
  FetchLike,
  RestRobotAdapterOptions
} from './RestRobotAdapter';
import type { AdapterLogSink } from './StructuredAdapterLogger';
import { YongyidaAdapter } from './YongyidaAdapter';

type SharedDependencyKey =
  | 'fetchImpl'
  | 'logger'
  | 'onMetric'
  | 'now'
  | 'sleep'
  | 'random'
  | 'idGenerator'
  | 'onAttempt'
  | 'wallClockNow';

export interface AdapterFactoryDependencies {
  readonly fetchImpl?: FetchLike;
  readonly logger?: AdapterLogSink;
  readonly onMetric?: (metric: AdapterMetric) => void;
  readonly now?: () => number;
  readonly sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
  readonly random?: () => number;
  readonly idGenerator?: () => string;
  readonly onAttempt?: (
    operation: string,
    attempt: number,
    signal?: AbortSignal
  ) => void | Promise<void>;
  readonly wallClockNow?: () => number;
}

type VendorAdapterConfiguration = Omit<RestRobotAdapterOptions, SharedDependencyKey> &
  Partial<Pick<RestRobotAdapterOptions, SharedDependencyKey>>;

export type RobotAdapterConfiguration =
  | (VendorAdapterConfiguration & { readonly vendor: 'yongyida' })
  | (VendorAdapterConfiguration & { readonly vendor: 'jiangzhi' });

/**
 * Explicit factory: callers provide a vendor per adapter instance. There is no
 * process-global ROBOT_TYPE, so one backend can route to both manufacturers.
 */
export class AdapterFactory {
  private readonly dependencies: AdapterFactoryDependencies;

  constructor(dependencies: AdapterFactoryDependencies = {}) {
    this.dependencies = Object.freeze({ ...dependencies });
  }

  create(configuration: RobotAdapterConfiguration): RobotAdapter {
    const options: RestRobotAdapterOptions = {
      ...this.dependencies,
      ...configuration
    };
    if (configuration.vendor === 'yongyida') return new YongyidaAdapter(options);
    if (configuration.vendor === 'jiangzhi') return new JiangzhiAdapter(options);
    throw new RobotAdapterError('ADAPTER_CONFIGURATION_INVALID', 'Robot vendor is unsupported');
  }

  createRegistry(configurations: readonly RobotAdapterConfiguration[] = []): RobotAdapterRegistry {
    const registry = new RobotAdapterRegistry();
    for (const configuration of configurations) registry.register(this.create(configuration));
    return registry;
  }
}

/**
 * Adapter instances are keyed by immutable logical IDs, never by vendor.
 * Each registered adapter is bound to one physical robot after initialize();
 * register a distinct adapterId/instance for every paired robot.
 */
export class RobotAdapterRegistry {
  private readonly adapters = new Map<string, RobotAdapter>();

  get size(): number {
    return this.adapters.size;
  }

  register(adapter: RobotAdapter): RobotAdapter {
    if (!adapter || typeof adapter.adapterId !== 'string' || typeof adapter.initialize !== 'function') {
      throw new RobotAdapterError('ADAPTER_CONFIGURATION_INVALID', 'Robot adapter is invalid');
    }
    if (this.adapters.has(adapter.adapterId)) {
      throw new RobotAdapterError('ADAPTER_CONFIGURATION_INVALID', 'Robot adapter id is already registered');
    }
    this.adapters.set(adapter.adapterId, adapter);
    return adapter;
  }

  get(adapterId: string): RobotAdapter | undefined {
    return this.adapters.get(adapterId);
  }

  require(adapterId: string): RobotAdapter {
    const adapter = this.get(adapterId);
    if (!adapter) {
      throw new RobotAdapterError('ADAPTER_CONFIGURATION_INVALID', 'Robot adapter is not registered');
    }
    return adapter;
  }

  has(adapterId: string): boolean {
    return this.adapters.has(adapterId);
  }

  list(): readonly RobotAdapter[] {
    return Object.freeze(Array.from(this.adapters.values()));
  }

  remove(adapterId: string): boolean {
    return this.adapters.delete(adapterId);
  }
}
