import {isDefined, error} from './basic';

/**
 * All persistent structures must implement this interface in order to participate in batches of
 * mutations among multiple persistent objects of different types. Though designed to allow for
 * batched mutations, `PersistentStructure` and the associated API functions provide a convenient
 * suite of functionality for providing any structural type with persistent/immutable behaviour and
 * associated mutation characteristics.
 *
 * @export
 * @interface PersistentStructure
 */
export interface PersistentStructure {
  /**
   * The associated mutation context. During construction of the first version of a persistent
   * object, use `immutableContext()` if default immutability is required, or `mutableContext()` if
   * the object should be constructed in a mutable state. Do not reassign this property after it has
   * been assigned during construction. Do not ever directly modify its internal properties.
   *
   * @type {MutationContext}
   * @memberOf PersistentStructure
   */
  readonly '@@mctx': MutationContext;

  /**
   * Create a clone of the structure, retaining all relevant internal properties and state as-is.
   * The method is provided with a new MutationContext instance, which should be assigned to the
   * clone of the object during construction. Internal subordinate persistent substructures should
   * not be cloned at this time. When updates are being applied to a persistent object,
   * substructures should use `asMutable()`, with their owning structure passed in as the joining
   * context.
   *
   * @param {MutationContext} mctx
   * @returns {PersistentStructure}
   *
   * @memberOf PersistentStructure
   */
  '@@clone'(mctx: MutationContext): PersistentStructure;
}

/**
 * A mutation context stores contextual information with respect to the temporary mutability of a
 * persistent object and zero or more other persistent objects (of the same or differing types) with
 * which it is associated. Once a mutation context has been frozen, it cannot be unfrozen; the
 * associated persistent objects must first be cloned with new mutation contexts. Freezing a
 * mutation context is an in-place operation; given that it indicates that mutability is permitted,
 * the freezing of the context (and all associated persistent objects) is therefore the final
 * mutable operation performed against those objects.
 *
 * @export
 * @class MutationContext
 */
export class MutationContext {
  /**
   * A shared token indicating whether the mutation context is still active, or has become frozen.
   * A one-tuple is used because arrays can be shared by reference among multiple mutation contexts,
   * and the sole element can then be switched from `true` to `false` in order to simultaneously
   * make all associated persistent objects immutable with a single O(1) operation.
   *
   * @type {[boolean]}
   * @memberOf MutationContext
   */
  public readonly token: [boolean];

  /**
   * Indicates whether this MutationContext instance originated with the value to which it is
   * attached. If true, the shared token may be frozen when mutations are complete. If false, then
   * the freezing of the shared token must be performed with reference to the value where the
   * mutation context originated. Note that a non-owned MutationContext instance can itself be
   * shared among many persistent objects. For many objects to participate in a larger mutation
   * batch, it is only necessary to have two MutationContext instances; one for the owner, and one
   * for all subsequent persistent objects that are participating in, but not in control of, the
   * scope of the mutations.
   *
   * @type {boolean}
   * @memberOf MutationContext
   */
  public readonly owner: boolean;

  constructor(token: [boolean], owner: boolean) {
    this.token = token;
    this.owner = owner;
  }
}

const FROZEN = Object.freeze(new MutationContext([false], false));

/**
 * Returns the default frozen mutation context for use with new immutable objects. This function
 * should only be used when constructing the first version of a new persistent object. Any
 * subsequent copies of that object should use `doneMutating()` and related functions.
 *
 * @export
 * @returns {MutationContext} The default frozen mutation context
 */
export function frozenContext(): MutationContext {
  return FROZEN;
}

/**
 * Returns a new mutable context to be associated with, and owned by, a persistent object. This
 * function should only be used when constructing the first version of a new persistent object. Any
 * subsequent updates to that object should use `asMutable()` and related functions.
 *
 * @export
 * @returns {MutationContext}
 */
export function mutableContext(): MutationContext {
  return new MutationContext([true], true);
}

/**
 * Tests whether the value is currently in a mutable state, with changes able to be applied directly
 * to the value, rather than needing to clone the value first.
 *
 * @export
 * @param {PersistentStructure} value A value to test for mutability
 * @returns {boolean} true if the value may be mutated directly, otherwise false
 */
export function isMutable(value: PersistentStructure): boolean {
  return mctx(value).token[0];
}

/**
 * Tests whether the value is currently in an immutable state, requiring a clone to be created if
 * mutations are desired.
 *
 * @export
 * @param {PersistentStructure} value A value to be tested for immutability
 * @returns {boolean} true if direct mutations to the value or its contents are forbidden, otherwise false
 */
export function isImmutable(value: PersistentStructure): boolean {
  return !isMutable(value);
}

/**
 * Tests whether two values are currently part of the same active mutation context, whereby freezing
 * the mutation context of the value where it originated will cause all other values associated with
 * the same mutation context to become immutable also. This function returns false if either value
 * is immutable, even if they were both formerly associated with the same mutation context.
 *
 * @export
 * @param {PersistentStructure} a A value to compare with `b`
 * @param {PersistentStructure} b A value to compare with `a`
 * @returns {boolean} true if both values are associated with the same active mutation context, otherwise false
 */
export function isSameMutationContext(a: PersistentStructure, b: PersistentStructure): boolean {
  var t = token(a);
  return t[0] && t === token(b);
}

/**
 * Returns a mutable version of the input value. The same value is returned if already mutable and
 * not joining an existing mutation context, or if already associated with the mutation context
 * being joined. If immutable, or already mutable but joining a mutation context other than the one
 * with which it is currently associated, a mutable clone of the value is returned, associated with
 * a new mutation context, or the context associated with the `join` argument, if specified.
 *
 * @export
 * @template T The type of the persistent structure
 * @param {T} value The value for which mutability is being requested
 * @param {PersistentStructure} [join] If specified, the returned value will become associated with
 *   the same mutation context as that of the `join` argument
 * @returns {T} A version of the persistent structure that can be freely mutated
 */
export function asMutable<T extends PersistentStructure>(value: T, join?: PersistentStructure): T {
  return isDefined(join)
    ? isSameMutationContext(value, join) ? value : clone(shadow(join), value)
    : isMutable(value) ? value : clone(mutableContext(), value);
}

/**
 * Indicates that we have no further intent to mutate the input value from the calling context, then
 * returns the input value, as a convenience. The mutation context associated with the input value
 * is only frozen if it originated with the input value. If it did not, then the mutation context
 * will only become frozen once `doneMutating()` is called against the value where the mutation
 * context originated. Until then, the input value will continue to be mutable, thus facilitating
 * batched operations among multiple values.
 *
 * @export
 * @template T The type of the persistent structure
 * @param {T} value A value for which immediate subsequent mutations are no longer intended
 * @returns {T} The input value
 */
export function doneMutating<T extends PersistentStructure>(value: T): T {
  var mc = mctx(value);
  return isActive(mc) && isOwner(mc) && freeze(mc), value;
}

function token(value: PersistentStructure): [boolean] {
  return mctx(value).token;
}

function isActive(mctx: MutationContext): boolean {
  return mctx.token[0];
}

function freeze(mctx: MutationContext): void {
  mctx.token[0] = false;
}

function isOwner(mctx: MutationContext): boolean {
  return mctx.owner;
}

function mctx(value: PersistentStructure): MutationContext {
  var mc = value['@@mctx'];
  return isDefined(mc) ? mc : FROZEN;
}

function shadow(value: PersistentStructure): MutationContext {
  var mc = mctx(value);
  return isActive(mc)
    ? mc.owner ? new MutationContext(mc.token, false) : mc
    : error('Cannot join a finalized mutation context');
}

function clone<T extends PersistentStructure>(mctx: MutationContext, value: T): T {
  return <T>value['@@clone'](mctx);
}
