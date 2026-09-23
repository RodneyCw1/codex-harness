# 实现文档（模拟案例）

TASK-DEMO，规范版本1，功能F-001。此案例未执行真实代码。

REQ-001：规范化名称时删除两端空格，保留中间空格。REQ-002：空串或全空格名称应返回既有 ValidationError。

模拟项目已有 src/name.py 的 normalize_name 入口和 tests/test_name.py；复用既有错误类型。允许修改这两个文件。只增加输入校验，不改变返回类型，不新增依赖。

AC-001对应正常名称处理，AC-002对应空输入处理；具体标准见 acceptance.md，用例见 test-plan.md。
