'use client';

import { useState, useEffect, useMemo } from 'react';
import { ChevronRight, ChevronDown, Search } from 'lucide-react';
import {
  cn,
  Button,
  apiClient,
  Checkbox,
  Input,
  Textarea,
  DialogRoot,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from '@saas/ui';
import { toast } from 'sonner';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';

interface Role {
  id: string;
  name: string;
  description: string;
  permissions: Permission[];
}

interface Permission {
  id: string;
  name: string;
  description: string;
}

interface RoleDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  role?: Role | null;
  readOnly?: boolean;
}

const createRoleSchema = (currentId?: string) => z.object({
  name: z.string()
    .min(3, 'Name must be at least 3 characters')
    .regex(/^[A-Z0-9-_]+$/, 'Name must contain only uppercase letters, numbers, hyphens, and underscores (no spaces)')
    .refine((name) => name.toUpperCase() !== 'SYSADMIN', 'Role name "SYSADMIN" is reserved')
    .refine(async (name) => {
      try {
        const params: Record<string, string> = { name };
        if (currentId) params.excludeId = currentId;
        const data = await apiClient.get<{ available: boolean }>('/system/roles/check-name', params);
        return data.available;
      } catch {
        return true;
      }
    }, 'Role name already exists'),
  description: z.string().min(1, 'Description is required'),
  permissionIds: z.array(z.string()).optional(),
});

type RoleFormValues = z.infer<ReturnType<typeof createRoleSchema>>;

interface TreeNode {
  key: string;
  path: string;
  permission?: Permission;
  children: TreeNode[];
}

const buildTree = (permissions: Permission[]): TreeNode[] => {
  const root: TreeNode[] = [];
  const sortedPermissions = [...permissions].sort((a, b) => a.name.localeCompare(b.name));

  for (const perm of sortedPermissions) {
    const parts = perm.name.split('.');
    let currentLevel = root;
    let currentPath = '';

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      currentPath = currentPath ? `${currentPath}.${part}` : part;

      let node = currentLevel.find((n) => n.key === part);

      if (!node) {
        node = {
          key: part,
          path: currentPath,
          children: [],
        };
        currentLevel.push(node);
      }

      if (i === parts.length - 1) {
        node.permission = perm;
      }

      currentLevel = node.children;
    }
  }
  return root;
};

const getAllPermissionIds = (node: TreeNode): string[] => {
  let ids: string[] = [];
  if (node.permission) {
    ids.push(node.permission.id);
  }
  for (const child of node.children) {
    ids = [...ids, ...getAllPermissionIds(child)];
  }
  return ids;
};

const PermissionTreeNode = ({
  node,
  selectedIds,
  onToggle,
  level = 0,
  expandAll = false,
  readOnly = false,
}: {
  node: TreeNode;
  selectedIds: string[];
  onToggle: (ids: string[], checked: boolean) => void;
  level?: number;
  expandAll?: boolean;
  readOnly?: boolean;
}) => {
  const [isExpanded, setIsExpanded] = useState(expandAll);

  useEffect(() => {
    if (expandAll) {
      setIsExpanded(true);
    }
  }, [expandAll]);

  const descendantIds = getAllPermissionIds(node);
  const checkedCount = descendantIds.filter((id) => selectedIds.includes(id)).length;
  const isChecked = descendantIds.length > 0 && checkedCount === descendantIds.length;
  const isIndeterminate = checkedCount > 0 && checkedCount < descendantIds.length;
  const hasChildren = node.children.length > 0;

  const handleCheck = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (readOnly) return;
    onToggle(descendantIds, e.target.checked);
  };

  return (
    <div className="select-none">
      <div
        className={cn(
          "flex items-center gap-2 py-1 hover:bg-accent/50 rounded px-2",
          readOnly && "pointer-events-none"
        )}
      >
        {hasChildren ? (
          <button
            type="button"
            onClick={() => setIsExpanded(!isExpanded)}
            className={cn(
              "h-4 w-4 flex items-center justify-center text-muted-foreground hover:text-foreground",
              readOnly && "pointer-events-auto"
            )}
          >
            {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          </button>
        ) : (
          <div className="w-4" />
        )}

        <Checkbox
          id={`node-${node.path}`}
          checked={isChecked}
          indeterminate={isIndeterminate}
          onChange={handleCheck}
          disabled={readOnly}
        />

        <label
          htmlFor={`node-${node.path}`}
          className={cn(
            "text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer flex-1 flex items-center gap-2",
            readOnly && "cursor-default"
          )}
        >
          <span>{node.key}</span>
          {node.permission && (
            <span className="text-xs text-muted-foreground font-normal truncate max-w-[300px]">
              - {node.permission.description}
            </span>
          )}
        </label>
      </div>

      {hasChildren && isExpanded && (
        <div className="flex flex-col ml-6">
          {node.children.map((child) => (
            <PermissionTreeNode
              key={child.path}
              node={child}
              selectedIds={selectedIds}
              onToggle={onToggle}
              level={level + 1}
              expandAll={expandAll}
              readOnly={readOnly}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export function RoleDialog({
  isOpen,
  onClose,
  onSuccess,
  role,
  readOnly = false,
}: RoleDialogProps) {
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [loadingPermissions, setLoadingPermissions] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<RoleFormValues>({
    resolver: zodResolver(createRoleSchema(role?.id)),
    defaultValues: {
      name: '',
      description: '',
      permissionIds: [],
    },
  });

  const selectedPermissionIds = watch('permissionIds') || [];

  useEffect(() => {
    if (isOpen) {
      fetchPermissions();
      if (role) {
        reset({
          name: role.name,
          description: role.description,
          permissionIds: role.permissions.map(p => p.id),
        });
      } else {
        reset({
          name: '',
          description: '',
          permissionIds: [],
        });
      }
    }
  }, [isOpen, role, reset]);

  const fetchPermissions = async () => {
    setLoadingPermissions(true);
    try {
      const data = await apiClient.get<{ data: Permission[] }>('/system/permissions', { limit: 1000 });
      setPermissions(data.data);
    } catch (error) {
      console.warn('Failed to fetch permissions', error);
      toast.error('Failed to load permissions');
    } finally {
      setLoadingPermissions(false);
    }
  };

  const onSubmit = async (data: RoleFormValues) => {
    try {
      if (role) {
        await apiClient.patch(`/system/roles/${role.id}`, data);
      } else {
        await apiClient.post('/system/roles', data);
      }
      toast.success(`Role ${role ? 'updated' : 'created'} successfully`);
      onSuccess();
      onClose();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'An error occurred while saving role';
      toast.error(message);
    }
  };

  const togglePermission = (ids: string[], checked: boolean) => {
    const current = new Set(selectedPermissionIds);

    if (checked) {
      ids.forEach(id => current.add(id));
    } else {
      ids.forEach(id => current.delete(id));
    }
    setValue('permissionIds', Array.from(current));
  };

  const filteredPermissions = useMemo(() => {
    if (!searchQuery) return permissions;
    const lowerQuery = searchQuery.toLowerCase();
    return permissions.filter(p =>
      p.name.toLowerCase().includes(lowerQuery) ||
      p.description.toLowerCase().includes(lowerQuery)
    );
  }, [permissions, searchQuery]);

  const permissionTree = useMemo(() => buildTree(filteredPermissions), [filteredPermissions]);

  return (
    <DialogRoot open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent size="lg" className="max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>
            {readOnly ? 'Role Details' : role ? 'Edit Role' : 'Create Role'}
          </DialogTitle>
          <DialogDescription>
            {readOnly ? 'View role details and permissions.' : role ? 'Update existing role details.' : 'Add a new role to the system.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 flex flex-col flex-1 overflow-hidden px-6">
          <div className="space-y-4 flex-shrink-0">
            <div className="space-y-2">
              <label className="text-sm font-medium leading-none text-foreground">
                Name <span className="text-red-500">*</span>
              </label>
              <Input
                type="text"
                className="uppercase"
                error={!!errors.name}
                {...register('name')}
                onInput={(e) => {
                  e.currentTarget.value = e.currentTarget.value.toUpperCase().replace(/\s/g, '');
                }}
                placeholder="e.g. ADMIN"
                disabled={readOnly}
              />
              {errors.name && (
                <p className="text-sm text-red-500">{errors.name.message}</p>
              )}
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium leading-none text-foreground">
                Description <span className="text-red-500">*</span>
              </label>
              <Textarea
                error={!!errors.description}
                {...register('description')}
                placeholder="Describe what this role is for..."
                disabled={readOnly}
              />
              {errors.description && (
                <p className="text-sm text-red-500">{errors.description.message}</p>
              )}
            </div>
          </div>

          <div className="space-y-2 flex-1 flex flex-col min-h-0">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium leading-none text-foreground">
                Permissions
              </label>
            </div>
            <div className="border border-border rounded-md flex flex-col flex-1 bg-muted/10 overflow-hidden shadow-sm">
              <div className="p-0 border-b border-border bg-card sticky top-0 z-10">
                <div className="relative">
                  <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search permissions..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-8 bg-card border-0 rounded-none shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
                  />
                </div>
              </div>
              <div className="p-4 overflow-y-auto flex-1">
                {loadingPermissions ? (
                  <div className="text-sm text-muted-foreground text-center py-4">Loading permissions...</div>
                ) : permissions.length === 0 ? (
                  <div className="text-sm text-muted-foreground text-center py-4">No permissions found</div>
                ) : (
                  <div className="grid grid-cols-1 gap-2">
                    {permissionTree.map((node) => (
                      <PermissionTreeNode
                        key={node.path}
                        node={node}
                        selectedIds={selectedPermissionIds}
                        onToggle={togglePermission}
                        expandAll={!!searchQuery}
                        readOnly={readOnly}
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </form>

        <DialogFooter className="gap-2 sm:gap-0 pt-4">
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={isSubmitting}
          >
            {readOnly ? 'Close' : 'Cancel'}
          </Button>
          {!readOnly && (
            <Button
              disabled={isSubmitting}
              isLoading={isSubmitting}
              onClick={handleSubmit(onSubmit)}
            >
              {role ? 'Update' : 'Create'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </DialogRoot>
  );
}
