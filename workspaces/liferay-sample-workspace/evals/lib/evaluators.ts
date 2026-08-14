import type { Evaluator } from "@langfuse/client";

export const skillsInvokedEvaluator : Evaluator = async({expectedOutput, output }) => {
    if ((expectedOutput.skillsInvoked.length === output.skillsInvoked.length)) {
        output.skillsInvoked = output.skillsInvoked.sort();
        expectedOutput.skillsInvoked = expectedOutput.skillsInvoked.sort();

        for (let i = 0; i < expectedOutput.skillsInvoked.length; i++) {
            if (expectedOutput.skillsInvoked[i] !== output.skillsInvoked[i]) {
                return {
                    name: "skillsInvoked",
                    value: 0.0,
                    comment: "incorrect skill(s) invoked: " + output.skillsInvoked,
                };
            }
        }

        return {
            name: "skillsInvoked",
            value: 1.0,
            comment: "correct skill(s) invoked"
        };
    }

    return {
        name: "skillsInvoked",
        value: 0.0,
        comment: "incorrect skill(s) invoked: " + output.skillsInvoked,
    };
};
