package xyz.rth1.jinsuper811.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import xyz.rth1.jinsuper811.PasswordGate

/**
 * PasswordGate.kt（界面）—— 「录作业」前的那道门
 * ===========================================================
 * 约定（和 PasswordGate.kt 的说明一起看）：
 *
 *   · 密码**不在网页 JS 里**，验证只在这里做 —— 页面代码在 WebView 里能被读出来；
 *   · 过了之后**本进程内有效**（`PasswordGate.unlocked`），退出编辑模式 / 进程结束即失效；
 *   · 错了只说「密码不对」，不透露别的；**不限次数**（给同学用，不做防爆破）；
 *   · **不做「记住密码」**，也不做「忘记密码」（忘了就联系管理员重打 APK）。
 *
 * 这个界面故意做得没什么好玩的：一句说明、一个输入框、两个按钮。
 * 它不是给同学看的，是给「想改作业的同学」看的。
 */
@Composable
fun PasswordGateScreen(onPass: () -> Unit, onCancel: () -> Unit) {
    var input by remember { mutableStateOf("") }
    var wrong by remember { mutableStateOf(false) }

    fun submit() {
        if (PasswordGate.tryUnlock(input)) {
            wrong = false
            onPass()
        } else {
            wrong = true
            input = ""          // 清掉，省得同学一个个字符改
        }
    }

    Surface(color = MaterialTheme.colorScheme.background, modifier = Modifier.fillMaxSize()) {
        Column(
            verticalArrangement = Arrangement.Center,
            horizontalAlignment = Alignment.CenterHorizontally,
            modifier = Modifier
                .fillMaxSize()
                .padding(28.dp),
        ) {
            Text("🔒", style = MaterialTheme.typography.titleLarge)
            Spacer(Modifier.height(10.dp))
            Text(
                text = "要进「录作业」先对暗号",
                style = MaterialTheme.typography.titleMedium,
            )
            Spacer(Modifier.height(18.dp))

            OutlinedTextField(
                value = input,
                onValueChange = {
                    input = it
                    if (wrong) wrong = false
                },
                label = { Text("密码") },
                singleLine = true,
                isError = wrong,
                visualTransformation = PasswordVisualTransformation(),
                keyboardOptions = KeyboardOptions(
                    keyboardType = KeyboardType.NumberPassword,
                    imeAction = ImeAction.Done,
                ),
                keyboardActions = KeyboardActions(onDone = { submit() }),
                shape = RoundedCornerShape(Radii.md.dp),
                modifier = Modifier.fillMaxWidth(),
            )

            Spacer(Modifier.height(8.dp))
            Text(
                text = if (wrong) "密码不对" else " ",
                style = MaterialTheme.typography.bodyMedium,
                color = if (wrong) MaterialTheme.colorScheme.error
                else MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.fillMaxWidth(),
            )

            Spacer(Modifier.height(14.dp))
            Button(
                onClick = { submit() },
                enabled = input.isNotEmpty(),
                shape = RoundedCornerShape(Radii.md.dp),
                modifier = Modifier
                    .fillMaxWidth()
                    .height(52.dp),
            ) { Text("进去") }

            Spacer(Modifier.height(4.dp))
            TextButton(onClick = onCancel, modifier = Modifier.height(48.dp)) {
                Text("算了，只看作业")
            }

            Spacer(Modifier.height(20.dp))
            Text(
                text = "这里只拦得住同学。想改密码就改 PasswordGate.kt 里的常量，重打一个 APK。",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}
