import { colours } from '@fdv/shared';
import { render, screen } from '@testing-library/react-native';
import { Pressable, Text, View } from 'react-native';
import '../i18n';
import Licences from '../app/licences';
import { audit } from '../test-support/a11y';

/** The audit itself (4.17): it catches what it says it catches. */
describe('the accessibility audit', () => {
  const button = (
    <Pressable accessibilityRole="button" accessibilityLabel="Go" style={{ minHeight: 44 }} onPress={() => undefined} />
  );

  it('a status shown by colour alone is caught; in words, or labelled, it is not', async () => {
    await render(
      <View>
        {button}
        <View testID="dot" style={{ backgroundColor: colours.danger, width: 8, height: 8 }} />
      </View>,
    );
    expect(audit()).toEqual(['View#dot shows a status by colour alone']);
    await render(
      <View>
        {button}
        <View style={{ backgroundColor: colours.warnSoft }}>
          <Text>Expires in 12 days</Text>
        </View>
        <View
          accessible
          accessibilityLabel="Expired"
          style={{ backgroundColor: colours.danger, width: 8, height: 8 }}
        />
        <View style={{ backgroundColor: colours.ok }}>
          <Text>{3}</Text>
        </View>
      </View>,
    );
    expect(audit()).toEqual([]);
  });

  it('a pressable with no role, no name or too small a target is caught', async () => {
    await render(
      <View>
        {/* eslint-disable-next-line react-native-a11y/has-valid-accessibility-descriptors -- what the audit must catch */}
        <Pressable testID="tiny" style={{ height: 20 }} onPress={() => undefined} />
      </View>,
    );
    expect(audit()).toEqual([
      'View#tiny has no role',
      'View#tiny has no label',
      'View#tiny is 20 dp tall with its hit slop',
    ]);
  });

  it('Licences can be read with a screen reader', async () => {
    await render(<Licences />);
    expect(screen.getByText(/Family Vault is made with \d+ pieces of open-source software/)).toBeTruthy();
    // Each row is one thing read out: its name, versions and licence.
    expect(screen.getByLabelText('@babel/code-frame 7.29.7, MIT')).toBeTruthy();
  });
});
