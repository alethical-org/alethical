import { ComponentType, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View, ViewStyle } from 'react-native';
import {
  BadgeDollarSign,
  Bus,
  ChevronDown,
  GraduationCap,
  Grid3X3,
  Heart,
  Home,
  Leaf,
  Scale,
  Search,
  Shield,
  TrendingUp,
} from 'lucide-react-native';

import { useResponsive } from '../hooks/useResponsive';
import { usePolicyAreas, useSessions } from '../hooks/useAppQueries';
import { theme } from '../theme/tokens';
import { fieldFocusRing, fieldOutlineReset, useFieldFocus } from '../theme/fieldFocus';
import { Card } from './Card';

export type ChamberFilter = 'All' | 'House' | 'Senate';

const ALL_POLICIES = 'All Policies';
const ALL_STATUSES = 'All Statuses';
const ALL_YEARS = 'All Years';
const statusOptions = [
  { label: ALL_STATUSES, value: '' },
  { label: 'Proposed', value: 'proposed' },
  { label: 'In Committee', value: 'in_committee' },
  { label: 'Passed House', value: 'passed_house' },
  { label: 'Passed Senate', value: 'passed_senate' },
  { label: 'Signed Into Law', value: 'signed_into_law' },
  { label: 'Vetoed', value: 'vetoed' },
];
type FilterIcon = ComponentType<{ color?: string; size?: number; strokeWidth?: number }>;

interface SearchFilterPanelProps {
  query: string;
  chamber: ChamberFilter;
  policyArea: string;
  omnibusOnly: boolean;
  status: string;
  session: string;
  onQueryChange: (value: string) => void;
  onChamberChange: (value: ChamberFilter) => void;
  onPolicyAreaChange: (value: string) => void;
  onOmnibusOnlyChange: (value: boolean) => void;
  onStatusChange: (value: string) => void;
  onSessionChange: (value: string) => void;
  onQueryFocus?: () => void;
  onControlPress?: () => void;
  style?: ViewStyle;
}

export function SearchFilterPanel({
  query,
  chamber,
  policyArea,
  omnibusOnly,
  status,
  session,
  onQueryChange,
  onChamberChange,
  onPolicyAreaChange,
  onOmnibusOnlyChange,
  onStatusChange,
  onSessionChange,
  onQueryFocus,
  onControlPress,
  style,
}: SearchFilterPanelProps) {
  const { isDesktop } = useResponsive();
  const { focused: queryFocused, focusProps: queryFocusProps } = useFieldFocus();
  const [openMenu, setOpenMenu] = useState<'status' | 'year' | 'topic' | null>(null);
  const policyAreasQuery = usePolicyAreas(session || undefined);
  const sessionsQuery = useSessions();
  const yearOptions = useMemo(
    () => [
      { label: ALL_YEARS, value: '' },
      ...(sessionsQuery.data ?? []).map((item) => ({
        label: sessionLabel(item.name, item.slug),
        value: item.slug,
      })),
    ],
    [sessionsQuery.data],
  );
  const policyCategories = [
    { label: ALL_POLICIES, Icon: Grid3X3 },
    ...(policyAreasQuery.data ?? []).map((item) => ({
      label: item.name,
      Icon: iconForPolicyArea(item.name),
    })),
  ].slice(0, 8);

  function handleControlPress(action: () => void) {
    onControlPress?.();
    action();
  }

  const statusLabel = statusOptions.find((item) => item.value === status)?.label ?? ALL_STATUSES;
  const yearLabel = yearOptions.find((item) => item.value === session)?.label ?? ALL_YEARS;
  const policyLabel =
    policyArea === ALL_POLICIES ? ALL_POLICIES : formatPolicyAreaLabel(policyArea);

  return (
    <Card style={[styles.panel, style]}>
      <View style={[styles.searchBox, ...fieldFocusRing(queryFocused)]}>
        <Search color={theme.colors.mutedInk} size={18} strokeWidth={2} />
        <TextInput
          accessibilityLabel="Search bills and legislators"
          placeholder="Search keyword or bills (e.g. HF 2904, SF 1832)"
          placeholderTextColor={theme.colors.mutedInk}
          style={[styles.searchInput, fieldOutlineReset]}
          value={query}
          onFocus={() => {
            queryFocusProps.onFocus();
            onQueryFocus?.();
          }}
          onBlur={queryFocusProps.onBlur}
          onChangeText={onQueryChange}
        />
      </View>

      <View style={[styles.controlRow, !isDesktop && styles.controlRowMobile]}>
        <SegmentedFilter
          value={chamber}
          onChange={(next) => handleControlPress(() => onChamberChange(next))}
        />
        <ToolbarButton
          label="Omnibus"
          Icon={Scale}
          selected={omnibusOnly}
          onPress={() => handleControlPress(() => onOmnibusOnlyChange(!omnibusOnly))}
        />
        <DropdownControl
          label={statusLabel}
          open={openMenu === 'status'}
          options={statusOptions}
          selectedValue={status}
          onToggle={() => setOpenMenu((value) => (value === 'status' ? null : 'status'))}
          onSelect={(value) => {
            setOpenMenu(null);
            handleControlPress(() => onStatusChange(value));
          }}
        />
        <DropdownControl
          label={yearLabel}
          open={openMenu === 'year'}
          options={yearOptions}
          selectedValue={session}
          onToggle={() => setOpenMenu((value) => (value === 'year' ? null : 'year'))}
          onSelect={(value) => {
            setOpenMenu(null);
            handleControlPress(() => onSessionChange(value));
          }}
        />
        {!isDesktop ? (
          <DropdownControl
            label={policyLabel}
            open={openMenu === 'topic'}
            options={policyCategories.map(({ label }) => ({
              label: formatPolicyAreaLabel(label),
              value: label,
            }))}
            selectedValue={policyArea}
            onToggle={() => setOpenMenu((value) => (value === 'topic' ? null : 'topic'))}
            onSelect={(value) => {
              setOpenMenu(null);
              handleControlPress(() => onPolicyAreaChange(value));
            }}
          />
        ) : null}
      </View>

      {isDesktop ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.policyRow}
          style={styles.policyScroller}
        >
          {policyCategories.map(({ label, Icon }) => (
            <PolicyPill
              key={label}
              label={formatPolicyAreaLabel(label)}
              Icon={Icon}
              selected={policyArea === label}
              onPress={() => handleControlPress(() => onPolicyAreaChange(label))}
            />
          ))}
        </ScrollView>
      ) : null}
    </Card>
  );
}

export function allPoliciesLabel() {
  return ALL_POLICIES;
}

export function allStatusesLabel() {
  return ALL_STATUSES;
}

interface SegmentedFilterProps {
  value: ChamberFilter;
  onChange: (value: ChamberFilter) => void;
}

function SegmentedFilter({ value, onChange }: SegmentedFilterProps) {
  return (
    <View style={styles.segmentedControl}>
      {(['All', 'House', 'Senate'] as ChamberFilter[]).map((option) => {
        const selected = value === option;
        return (
          <Pressable
            accessibilityRole="button"
            key={option}
            onPress={() => onChange(option)}
            style={({ pressed }) => [
              styles.segmentButton,
              selected && styles.segmentButtonSelected,
              pressed && styles.pressed,
            ]}
          >
            <Text style={[styles.segmentText, selected && styles.segmentTextSelected]}>
              {option}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

interface ToolbarButtonProps {
  label: string;
  Icon?: FilterIcon;
  rightIcon?: boolean;
  selected?: boolean;
  onPress?: () => void;
}

function ToolbarButton({
  label,
  Icon,
  rightIcon = false,
  selected = false,
  onPress,
}: ToolbarButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.toolbarButton,
        selected && styles.toolbarButtonSelected,
        pressed && styles.pressed,
      ]}
    >
      {Icon ? (
        <Icon color={selected ? theme.colors.white : theme.colors.ink} size={18} strokeWidth={2} />
      ) : null}
      <Text style={[styles.toolbarButtonText, selected && styles.toolbarButtonTextSelected]}>
        {label}
      </Text>
      {rightIcon ? (
        <ChevronDown
          color={selected ? theme.colors.white : theme.colors.ink}
          size={16}
          strokeWidth={2}
        />
      ) : null}
    </Pressable>
  );
}

interface DropdownControlProps {
  label: string;
  open: boolean;
  options: Array<{ label: string; value: string }>;
  selectedValue: string;
  onToggle: () => void;
  onSelect: (value: string) => void;
}

function DropdownControl({
  label,
  open,
  options,
  selectedValue,
  onToggle,
  onSelect,
}: DropdownControlProps) {
  return (
    <View style={styles.dropdownWrap}>
      <Pressable
        accessibilityRole="button"
        onPress={onToggle}
        style={({ pressed }) => [
          styles.toolbarButton,
          styles.dropdownButton,
          pressed && styles.pressed,
        ]}
      >
        <Text style={styles.toolbarButtonText}>{label}</Text>
        <ChevronDown color={theme.colors.ink} size={16} strokeWidth={2} />
      </Pressable>
      {open ? (
        <View style={styles.dropdownMenu}>
          {options.map((option) => {
            const selected = option.value === selectedValue;
            return (
              <Pressable
                accessibilityRole="button"
                key={`${option.value}-${option.label}`}
                onPress={() => onSelect(option.value)}
                style={({ pressed }) => [styles.dropdownItem, pressed && styles.pressed]}
              >
                <Text style={styles.dropdownItemText}>{option.label}</Text>
                {selected ? <Text style={styles.dropdownCheck}>✓</Text> : null}
              </Pressable>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

interface PolicyPillProps {
  label: string;
  Icon: FilterIcon;
  selected: boolean;
  onPress: () => void;
}

function PolicyPill({ label, Icon, selected, onPress }: PolicyPillProps) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.policyPill,
        selected ? styles.policyPillSelected : styles.policyPillIdle,
        pressed && styles.pressed,
      ]}
    >
      <Icon color={selected ? theme.colors.white : theme.colors.ink} size={18} strokeWidth={2} />
      <Text style={[styles.policyPillText, selected && styles.policyPillTextSelected]}>
        {label}
      </Text>
    </Pressable>
  );
}

function formatPolicyAreaLabel(category: string): string {
  if (category === ALL_POLICIES) {
    return category;
  }

  return category
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join(' ');
}

function sessionLabel(name: string, slug: string): string {
  const yearMatch = name.match(/\b(20\d{2})(?:\s*-\s*(20\d{2}))?\b/) ?? slug.match(/\b(20\d{2})\b/);
  if (!yearMatch) {
    return name;
  }
  return yearMatch[2] ? `${yearMatch[1]}-${yearMatch[2]}` : yearMatch[1];
}

function iconForPolicyArea(category: string): FilterIcon {
  const normalized = category.toLowerCase();
  if (
    normalized.includes('education') ||
    normalized.includes('student') ||
    normalized.includes('school')
  ) {
    return GraduationCap;
  }
  if (normalized.includes('health') || normalized.includes('medical')) {
    return Heart;
  }
  if (normalized.includes('environment') || normalized.includes('energy')) {
    return Leaf;
  }
  if (
    normalized.includes('economic') ||
    normalized.includes('workforce') ||
    normalized.includes('labor')
  ) {
    return TrendingUp;
  }
  if (normalized.includes('housing')) {
    return Home;
  }
  if (normalized.includes('transport')) {
    return Bus;
  }
  if (normalized.includes('safety') || normalized.includes('criminal')) {
    return Shield;
  }
  if (normalized.includes('rights')) {
    return Scale;
  }
  if (
    normalized.includes('tax') ||
    normalized.includes('funding') ||
    normalized.includes('appropriation')
  ) {
    return BadgeDollarSign;
  }
  return Grid3X3;
}

const styles = StyleSheet.create({
  panel: {
    backgroundColor: theme.colors.surface,
    borderColor: theme.colors.border,
    borderRadius: theme.radii.md,
    borderWidth: 1,
    gap: theme.spacing.sm,
    padding: theme.spacing.md,
    position: 'relative',
    zIndex: 20,
  },
  searchBox: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    borderBottomWidth: 2,
    borderBottomColor: theme.colors.border,
  },
  searchInput: {
    minHeight: 48,
    flex: 1,
    color: theme.colors.ink,
    fontFamily: theme.typography.mono,
    fontSize: 15,
    paddingHorizontal: 0,
  },
  controlRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: theme.spacing.xs,
    zIndex: 30,
  },
  controlRowMobile: {
    alignItems: 'stretch',
  },
  segmentedControl: {
    minHeight: 38,
    flexDirection: 'row',
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  segmentButton: {
    minHeight: 36,
    minWidth: 58,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: theme.spacing.md,
  },
  segmentButtonSelected: {
    backgroundColor: theme.colors.ink,
  },
  segmentText: {
    color: theme.colors.ink,
    fontFamily: theme.typography.ui,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  segmentTextSelected: {
    color: theme.colors.white,
  },
  toolbarButton: {
    minHeight: 38,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing.xs,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
    paddingHorizontal: theme.spacing.sm,
  },
  dropdownWrap: {
    position: 'relative',
    zIndex: 40,
  },
  dropdownButton: {
    minWidth: 148,
  },
  dropdownMenu: {
    position: 'absolute',
    top: 40,
    left: 0,
    minWidth: 180,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
    zIndex: 50,
    elevation: 50,
  },
  dropdownItem: {
    minHeight: 38,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing.sm,
    paddingHorizontal: theme.spacing.sm,
  },
  dropdownItemText: {
    color: theme.colors.ink,
    fontFamily: theme.typography.ui,
    fontSize: 13,
  },
  dropdownCheck: {
    color: theme.colors.ink,
    fontFamily: theme.typography.ui,
    fontSize: 14,
    fontWeight: '700',
  },
  toolbarButtonSelected: {
    backgroundColor: theme.colors.ink,
  },
  toolbarButtonText: {
    color: theme.colors.ink,
    fontFamily: theme.typography.ui,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  toolbarButtonTextSelected: {
    color: theme.colors.white,
  },
  policyScroller: {
    zIndex: 1,
  },
  policyRow: {
    flexDirection: 'row',
    gap: theme.spacing.xs,
    paddingRight: theme.spacing.md,
  },
  policyPill: {
    minHeight: 38,
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.xs,
    borderWidth: 1,
    borderColor: theme.colors.border,
    paddingHorizontal: theme.spacing.sm,
  },
  policyPillIdle: {
    backgroundColor: theme.colors.surface,
  },
  policyPillSelected: {
    backgroundColor: theme.colors.ink,
  },
  policyPillText: {
    color: theme.colors.ink,
    fontFamily: theme.typography.ui,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  policyPillTextSelected: {
    color: theme.colors.white,
  },
  pressed: {
    opacity: 0.78,
  },
});
