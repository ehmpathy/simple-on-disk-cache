import { isAFunction } from 'type-fns';

import type { DirectoryToPersistTo } from '../../domain.objects/DirectoryToPersistTo';

/**
 * declares a method that's able to prepare the directory to persist to
 *
 * supports
 * - async getters
 * - direct declaration
 */
export const getDirectoryToPersistTo = async (
  input: DirectoryToPersistTo | (() => Promise<DirectoryToPersistTo>),
): Promise<DirectoryToPersistTo> =>
  isAFunction(input) ? await input() : input;
