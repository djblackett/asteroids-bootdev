package ca.davidandrea.spacearcade;

import android.os.Bundle;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // Capacitor's SystemBars plugin hides the bars (capacitor.config.ts) but has no option for how they come back. Without this a
        // swipe from the edge mid-game brings them back for good and shrinks the playfield; with it they slide in over the game and
        // hide again by themselves (the usual "immersive" behaviour for games).
        WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        controller.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
    }
}
