import type { Schema } from 'mongoose';

/**
 * Multi-tenancy guard.
 *
 * Every query on a tenant-scoped model MUST include `firmId` in its filter,
 * otherwise it throws. This makes cross-tenant leaks a loud bug instead of a
 * silent one. Background jobs and the public upload route, which legitimately
 * work across firms, must opt out explicitly:
 *
 *   Model.find({...}).setOptions({ crossTenant: true })
 */
export class TenantScopeError extends Error {
  constructor(model: string, op: string) {
    super(`Tenant scope missing: ${model}.${op} must filter by firmId (or set { crossTenant: true })`);
  }
}

const QUERY_OPS = [
  'countDocuments', 'deleteMany', 'deleteOne', 'distinct', 'find', 'findOne', 'findOneAndDelete',
  'findOneAndReplace', 'findOneAndUpdate', 'replaceOne', 'updateMany', 'updateOne',
] as const;

export function tenantPlugin(schema: Schema) {
  for (const op of QUERY_OPS) {
    schema.pre(op, function (this: any) {
      if (this.getOptions().crossTenant) return;
      const filter = this.getFilter();
      if (filter.firmId === undefined || filter.firmId === null) {
        throw new TenantScopeError(this.model.modelName, op);
      }
    });
  }
  schema.pre('aggregate', function (this: any) {
    if (this.options?.crossTenant) return;
    const first = this.pipeline()[0];
    if (!first?.$match || first.$match.firmId === undefined) {
      throw new TenantScopeError(this._model?.modelName ?? 'aggregate', 'aggregate');
    }
  });
}
