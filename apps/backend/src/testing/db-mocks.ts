// Chainable stubs for the Mongoose query shapes the MFA/auth services use.
// Model call SHAPE only — not real Mongo semantics.

/** `Model.findOne(...).lean()` → resolves to `r`. */
export const lean = <T>(r: T) => ({ lean: async () => r });

/** `Model.findOne(...).select(...).lean()` → resolves to `r`. */
export const selectLean = <T>(r: T) => ({ select: () => ({ lean: async () => r }) });

/** `Model.findById(...).select(...).populate(...).lean()` → resolves to `r`. */
export const selectPopulateLean = <T>(r: T) => ({
  select: () => ({ populate: () => ({ lean: async () => r }) }),
});
