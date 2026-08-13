import { StyleSheet, Text, View } from 'react-native';

import { theme as t } from '../../theme/tokens';

function accountInitial(name: string, email: string) {
  return (name.trim() || email.trim()).charAt(0).toUpperCase() || '?';
}

export function AccountCard({
  label,
  name,
  email,
}: {
  label: string;
  name: string;
  email: string;
}) {
  return (
    <View accessibilityLabel={`${label} ${name}, ${email}`} style={styles.card}>
      <View style={styles.avatar}>
        <Text style={styles.avatarText}>{accountInitial(name, email)}</Text>
      </View>
      <View style={styles.copy}>
        <Text style={styles.label}>{label}</Text>
        <Text numberOfLines={1} style={styles.name}>
          {name}
        </Text>
        <Text numberOfLines={1} style={styles.email}>
          {email}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: t.colors.surfaces.s200,
    borderWidth: 1,
    borderColor: 'rgba(17,21,15,0.1)',
    borderRadius: 12,
    paddingVertical: 13,
    paddingHorizontal: 14,
  },
  avatar: {
    width: 44,
    height: 44,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: t.colors.tint.t150,
    borderWidth: 1,
    borderColor: t.colors.tint.border,
    borderRadius: t.radii.pill,
  },
  avatarText: {
    fontFamily: t.typography.ui,
    fontSize: 18,
    lineHeight: 22,
    fontWeight: t.fontWeights.bold,
    color: t.colors.brand.forest,
  },
  copy: { flex: 1, minWidth: 0 },
  label: {
    marginBottom: 2,
    fontFamily: t.typography.ui,
    fontSize: t.fontSizes.meta,
    lineHeight: 18,
    fontWeight: t.fontWeights.semibold,
    color: t.colors.text.secondary,
  },
  name: {
    fontFamily: t.typography.ui,
    fontSize: t.fontSizes.body,
    lineHeight: 20,
    fontWeight: t.fontWeights.bold,
    color: t.colors.text.primary,
  },
  email: {
    marginTop: 1,
    fontFamily: t.typography.body,
    fontSize: 13.5,
    lineHeight: 19,
    color: '#6f756f',
  },
});
