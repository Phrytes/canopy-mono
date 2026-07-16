// Detox bootstrap (#254 — D-0 setup, 2026-05-26).  JUnit runner that
// hands control to Detox.runTests; from there the Jest-side test
// files take over via the JS bridge.  Idle / RN-context timeouts are
// configured via Detox JS-side opts in .detoxrc.js, not here.
package org.onderling.basis;

import com.wix.detox.Detox;

import org.junit.Rule;
import org.junit.Test;
import org.junit.runner.RunWith;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.filters.LargeTest;
import androidx.test.rule.ActivityTestRule;

@RunWith(AndroidJUnit4.class)
@LargeTest
public class DetoxTest {

    @Rule
    public ActivityTestRule<MainActivity> mActivityRule
            = new ActivityTestRule<>(MainActivity.class, false, false);

    @Test
    public void runDetoxTests() {
        Detox.runTests(mActivityRule);
    }
}
