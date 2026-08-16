import { useRef, type ReactNode } from 'react';
import {
  Animated,
  Pressable,
  type AccessibilityRole,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

interface Props {
  children: ReactNode;
  onPress?: () => void;
  onLongPress?: () => void;
  style?: StyleProp<ViewStyle>;
  disabled?: boolean;
  accessibilityLabel?: string;
  accessibilityRole?: AccessibilityRole;
  accessibilityState?: { disabled?: boolean; selected?: boolean; expanded?: boolean };
  scaleTo?: number;
}

export function MotionPressable({
  children,
  onPress,
  onLongPress,
  style,
  disabled = false,
  accessibilityLabel,
  accessibilityRole = 'button',
  accessibilityState,
  scaleTo = 0.965,
}: Props) {
  const scale = useRef(new Animated.Value(1)).current;

  const animate = (toValue: number) => {
    Animated.spring(scale, {
      toValue,
      damping: 18,
      stiffness: 360,
      mass: 0.42,
      useNativeDriver: true,
    }).start();
  };

  return (
    <Animated.View style={[style, { transform: [{ scale }] }, disabled && { opacity: 0.42 }]}>
      <Pressable
        disabled={disabled}
        onPress={onPress}
        onLongPress={onLongPress}
        onPressIn={() => animate(scaleTo)}
        onPressOut={() => animate(1)}
        accessibilityLabel={accessibilityLabel}
        accessibilityRole={accessibilityRole}
        accessibilityState={{ ...accessibilityState, disabled }}
        style={{ flex: 1 }}
      >
        {children}
      </Pressable>
    </Animated.View>
  );
}
